ALTER TABLE "inbox_v2_outbound_routes" DROP CONSTRAINT "inbox_v2_outbound_routes_reference_context_check";
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_reference_canonical_targets" DROP CONSTRAINT "inbox_v2_message_reference_canonical_targets_target_fk";
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_revisions" ADD CONSTRAINT "inbox_v2_message_revisions_target_unique" UNIQUE("tenant_id","message_id","timeline_item_id","message_revision");
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_reference_canonical_targets" ADD CONSTRAINT "inbox_v2_message_reference_canonical_targets_target_fk" FOREIGN KEY ("tenant_id","target_message_id","target_timeline_item_id","target_message_revision") REFERENCES "public"."inbox_v2_message_revisions"("tenant_id","message_id","timeline_item_id","message_revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_outbound_routes" ADD CONSTRAINT "inbox_v2_outbound_routes_reference_context_check" CHECK (((
      "inbox_v2_outbound_routes"."reference_context_snapshot" = '{"kind":"none"}'::jsonb
    ) or (
      "inbox_v2_outbound_routes"."reference_context_snapshot" #>> '{kind}' = 'external_message'
      and (
    "inbox_v2_outbound_routes"."reference_context_snapshot" #> '{externalThread}' = jsonb_build_object(
      'tenantId', "inbox_v2_outbound_routes"."tenant_id",
      'kind', 'external_thread',
      'id', "inbox_v2_outbound_routes"."external_thread_id"
    )
  )
      and coalesce((char_length("inbox_v2_outbound_routes"."reference_context_snapshot" #>>
    '{externalMessageReference,id}') <= 256
    and "inbox_v2_outbound_routes"."reference_context_snapshot" #>>
    '{externalMessageReference,id}' ~ '^external_message_reference:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false)
      and (
    "inbox_v2_outbound_routes"."reference_context_snapshot" #> '{externalMessageReference}' = jsonb_build_object(
      'tenantId', "inbox_v2_outbound_routes"."tenant_id",
      'kind', 'external_message_reference',
      'id', "inbox_v2_outbound_routes"."reference_context_snapshot" #>>
    '{externalMessageReference,id}'
    )
  )
      and coalesce((char_length("inbox_v2_outbound_routes"."reference_context_snapshot" #>> '{sourceOccurrence,id}') <= 256
    and "inbox_v2_outbound_routes"."reference_context_snapshot" #>> '{sourceOccurrence,id}' ~ '^source_occurrence:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false)
      and (
    "inbox_v2_outbound_routes"."reference_context_snapshot" #> '{sourceOccurrence}' = jsonb_build_object(
      'tenantId', "inbox_v2_outbound_routes"."tenant_id",
      'kind', 'source_occurrence',
      'id', "inbox_v2_outbound_routes"."reference_context_snapshot" #>> '{sourceOccurrence,id}'
    )
  )
      and coalesce((char_length("inbox_v2_outbound_routes"."reference_context_snapshot" #>> '{originBinding,id}') <= 256
    and "inbox_v2_outbound_routes"."reference_context_snapshot" #>> '{originBinding,id}' ~ '^source_thread_binding:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false)
      and (
    "inbox_v2_outbound_routes"."reference_context_snapshot" #> '{originBinding}' = jsonb_build_object(
      'tenantId', "inbox_v2_outbound_routes"."tenant_id",
      'kind', 'source_thread_binding',
      'id', "inbox_v2_outbound_routes"."reference_context_snapshot" #>> '{originBinding,id}'
    )
  )
      and coalesce((char_length("inbox_v2_outbound_routes"."reference_context_snapshot" #>>
    '{originSourceAccount,id}') <= 256
    and "inbox_v2_outbound_routes"."reference_context_snapshot" #>>
    '{originSourceAccount,id}' ~ '^source_account:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false)
      and (
    "inbox_v2_outbound_routes"."reference_context_snapshot" #> '{originSourceAccount}' = jsonb_build_object(
      'tenantId', "inbox_v2_outbound_routes"."tenant_id",
      'kind', 'source_account',
      'id', "inbox_v2_outbound_routes"."reference_context_snapshot" #>>
    '{originSourceAccount,id}'
    )
  )
      and "inbox_v2_outbound_routes"."reference_context_snapshot" #> '{portability}' #>> '{kind}' in (
        'binding_only', 'external_thread', 'provider_global'
      )
      and "inbox_v2_outbound_routes"."reference_context_snapshot" #> '{portability}' #>> '{decisionStrength}' in (
        'authoritative', 'safe_default'
      )
      and ("inbox_v2_outbound_routes"."reference_context_snapshot" #> '{portability}' #>> '{kind}' = 'binding_only'
        or "inbox_v2_outbound_routes"."reference_context_snapshot" #> '{portability}' #>> '{decisionStrength}' = 'authoritative')
      and "inbox_v2_outbound_routes"."reference_context_snapshot" #> '{portability}' #> '{adapterContract}' =
        "inbox_v2_outbound_routes"."adapter_contract_snapshot"
      and "inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #>> '{decisionKind}' =
        'external_message_reference_resolution'
      and "inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #>> '{tenantId}' = "inbox_v2_outbound_routes"."tenant_id"
      and "inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #> '{externalThread}' =
        "inbox_v2_outbound_routes"."reference_context_snapshot" #> '{externalThread}'
      and "inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #> '{externalMessageReference}' =
        "inbox_v2_outbound_routes"."reference_context_snapshot" #> '{externalMessageReference}'
      and "inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #> '{sourceOccurrence}' =
        "inbox_v2_outbound_routes"."reference_context_snapshot" #> '{sourceOccurrence}'
      and "inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #> '{originBinding}' =
        "inbox_v2_outbound_routes"."reference_context_snapshot" #> '{originBinding}'
      and "inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #> '{originSourceAccount}' =
        "inbox_v2_outbound_routes"."reference_context_snapshot" #> '{originSourceAccount}'
      and coalesce(("inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #>> '{occurrenceRevision}' ~ '^[1-9][0-9]{0,18}$'
    and (
      char_length("inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #>> '{occurrenceRevision}') < 19
      or "inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #>> '{occurrenceRevision}' <= '9223372036854775807'
    )), false)
      and coalesce(("inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #>> '{occurrenceBindingGeneration}' ~ '^[1-9][0-9]{0,18}$'
    and (
      char_length("inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #>> '{occurrenceBindingGeneration}') < 19
      or "inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #>> '{occurrenceBindingGeneration}' <= '9223372036854775807'
    )), false)
      and "inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #> '{occurrenceDescriptor}' #> '{adapterContract}' =
        "inbox_v2_outbound_routes"."adapter_contract_snapshot"
      and coalesce((char_length("inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #> '{occurrenceDescriptor}' #>> '{descriptorSchemaId}') <= 256 and (
    (
      "inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #> '{occurrenceDescriptor}' #>> '{descriptorSchemaId}' ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #> '{occurrenceDescriptor}' #>> '{descriptorSchemaId}', ':', 2)) <= 160
    ) or (
      "inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #> '{occurrenceDescriptor}' #>> '{descriptorSchemaId}' ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #> '{occurrenceDescriptor}' #>> '{descriptorSchemaId}', ':', 2)) <= 80
      and char_length(split_part("inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #> '{occurrenceDescriptor}' #>> '{descriptorSchemaId}', ':', 3)) <= 160
      and split_part("inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #> '{occurrenceDescriptor}' #>> '{descriptorSchemaId}', ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  )), false)
      and coalesce("inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #> '{occurrenceDescriptor}' #>> '{descriptorVersion}' ~ '^v[1-9][0-9]*$', false)
      and coalesce(("inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #> '{occurrenceDescriptor}' #>> '{capabilityRevision}' ~ '^[1-9][0-9]{0,18}$'
    and (
      char_length("inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #> '{occurrenceDescriptor}' #>> '{capabilityRevision}') < 19
      or "inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #> '{occurrenceDescriptor}' #>> '{capabilityRevision}' <= '9223372036854775807'
    )), false)
      and jsonb_typeof("inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #> '{occurrenceDescriptor}' #> '{providerReferences}') = 'array'
      and jsonb_array_length("inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #> '{occurrenceDescriptor}' #> '{providerReferences}')
        between 1 and 32
      and coalesce("inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #> '{occurrenceDescriptor}' #>> '{descriptorDigestSha256}' ~ '^[a-f0-9]{64}$', false)
      and "inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #> '{portability}' = "inbox_v2_outbound_routes"."reference_context_snapshot" #> '{portability}'
      and "inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #> '{availabilityObservation}' #>> '{observationKind}' =
        'external_message_reference_availability'
      and "inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #> '{availabilityObservation}' #>> '{tenantId}' = "inbox_v2_outbound_routes"."tenant_id"
      and "inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #> '{availabilityObservation}' #> '{externalThread}' =
        "inbox_v2_outbound_routes"."reference_context_snapshot" #> '{externalThread}'
      and "inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #> '{availabilityObservation}' #> '{externalMessageReference}' =
        "inbox_v2_outbound_routes"."reference_context_snapshot" #> '{externalMessageReference}'
      and "inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #> '{availabilityObservation}' #> '{sourceOccurrence}' =
        "inbox_v2_outbound_routes"."reference_context_snapshot" #> '{sourceOccurrence}'
      and "inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #> '{availabilityObservation}' #>> '{occurrenceRevision}' =
        "inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #>> '{occurrenceRevision}'
      and "inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #> '{availabilityObservation}' #>> '{occurrenceDescriptorDigestSha256}' =
        "inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #> '{occurrenceDescriptor}' #>> '{descriptorDigestSha256}'
      and "inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #> '{availabilityObservation}' #> '{adapterContract}' =
        "inbox_v2_outbound_routes"."adapter_contract_snapshot"
      and "inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #> '{availabilityObservation}' #>> '{state}' = 'available'
      and "inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #> '{availabilityObservation}' #> '{diagnostic}' = 'null'::jsonb
      and coalesce((char_length("inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #> '{availabilityObservation}' #>> '{observationToken}') between 8 and 256
    and "inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #> '{availabilityObservation}' #>> '{observationToken}' ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'), false)
      and coalesce((char_length("inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #> '{availabilityObservation}' #>> '{observedByTrustedServiceId}') <= 256 and (
    (
      "inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #> '{availabilityObservation}' #>> '{observedByTrustedServiceId}' ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #> '{availabilityObservation}' #>> '{observedByTrustedServiceId}', ':', 2)) <= 160
    ) or (
      "inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #> '{availabilityObservation}' #>> '{observedByTrustedServiceId}' ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #> '{availabilityObservation}' #>> '{observedByTrustedServiceId}', ':', 2)) <= 80
      and char_length(split_part("inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #> '{availabilityObservation}' #>> '{observedByTrustedServiceId}', ':', 3)) <= 160
      and split_part("inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #> '{availabilityObservation}' #>> '{observedByTrustedServiceId}', ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  )), false)
      and isfinite(("inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #> '{availabilityObservation}' #>> '{observedAt}')::timestamptz)
      and isfinite(("inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #> '{availabilityObservation}' #>> '{notAfter}')::timestamptz)
      and ("inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #> '{availabilityObservation}' #>> '{observedAt}')::timestamptz <=
        "inbox_v2_outbound_routes"."selected_at"
      and ("inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #> '{availabilityObservation}' #>> '{notAfter}')::timestamptz >=
        "inbox_v2_outbound_routes"."selected_at"
      and (
        "inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #> '{referenceWindow}' =
          '{"state":"not_applicable"}'::jsonb
        or (
          "inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #>> '{referenceWindow,state}' = 'valid'
          and isfinite(("inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #>>
            '{referenceWindow,notAfter}')::timestamptz)
          and ("inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #>>
            '{referenceWindow,notAfter}')::timestamptz >= "inbox_v2_outbound_routes"."selected_at"
        )
      )
      and coalesce((char_length("inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #>> '{decisionToken}') between 8 and 256
    and "inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #>> '{decisionToken}' ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'), false)
      and coalesce(("inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #>> '{decisionRevision}' ~ '^[1-9][0-9]{0,18}$'
    and (
      char_length("inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #>> '{decisionRevision}') < 19
      or "inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #>> '{decisionRevision}' <= '9223372036854775807'
    )), false)
      and coalesce((char_length("inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #>> '{loadedByTrustedServiceId}') <= 256 and (
    (
      "inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #>> '{loadedByTrustedServiceId}' ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #>> '{loadedByTrustedServiceId}', ':', 2)) <= 160
    ) or (
      "inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #>> '{loadedByTrustedServiceId}' ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #>> '{loadedByTrustedServiceId}', ':', 2)) <= 80
      and char_length(split_part("inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #>> '{loadedByTrustedServiceId}', ':', 3)) <= 160
      and split_part("inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #>> '{loadedByTrustedServiceId}', ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  )), false)
      and isfinite(("inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #>> '{decidedAt}')::timestamptz)
      and isfinite(("inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #>> '{notAfter}')::timestamptz)
      and ("inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #> '{occurrenceDescriptor}' #>> '{adapterContract,loadedAt}')::timestamptz <=
        ("inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #> '{availabilityObservation}' #>> '{observedAt}')::timestamptz
      and ("inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #> '{availabilityObservation}' #>> '{observedAt}')::timestamptz <=
        ("inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #>> '{decidedAt}')::timestamptz
      and ("inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #> '{availabilityObservation}' #>> '{notAfter}')::timestamptz >=
        ("inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #>> '{notAfter}')::timestamptz
      and ("inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #>> '{decidedAt}')::timestamptz <= "inbox_v2_outbound_routes"."selected_at"
      and ("inbox_v2_outbound_routes"."reference_context_snapshot" #> '{resolutionDecision}' #>> '{notAfter}')::timestamptz >= "inbox_v2_outbound_routes"."selected_at"
    )) is true);
--> statement-breakpoint
-- INBOX_V2_REPLY_FORWARD_MIGRATION_FINALIZED_V1
create or replace function public.inbox_v2_outbound_route_guard_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  perform 1
    from public.inbox_v2_source_thread_binding_snapshots snapshot_row
    join public.inbox_v2_source_thread_binding_heads head_row
      on head_row.tenant_id = snapshot_row.tenant_id
     and head_row.binding_id = snapshot_row.binding_id
     and head_row.revision = snapshot_row.revision
     and head_row.external_thread_id = snapshot_row.external_thread_id
     and head_row.source_connection_id = snapshot_row.source_connection_id
     and head_row.source_account_id = snapshot_row.source_account_id
     and head_row.account_generation = snapshot_row.account_generation
     and head_row.binding_generation = snapshot_row.binding_generation
     and head_row.remote_access_revision = snapshot_row.remote_access_revision
     and head_row.administrative_revision = snapshot_row.administrative_revision
     and head_row.capability_revision = snapshot_row.capability_revision
     and head_row.route_descriptor_revision = snapshot_row.route_descriptor_revision
   where snapshot_row.tenant_id = new.tenant_id
     and snapshot_row.binding_id = new.source_thread_binding_id
     and snapshot_row.revision = new.binding_revision
     and snapshot_row.external_thread_id = new.external_thread_id
     and snapshot_row.source_connection_id = new.source_connection_id
     and snapshot_row.source_account_id = new.source_account_id
     and snapshot_row.account_generation = new.account_generation
     and snapshot_row.binding_generation = new.binding_generation
     and snapshot_row.remote_access_revision = new.remote_access_revision
     and snapshot_row.administrative_revision = new.administrative_revision
     and snapshot_row.capability_revision = new.capability_revision
     and snapshot_row.route_descriptor_revision = new.route_descriptor_revision
     and snapshot_row.remote_access_state = 'active'
     and snapshot_row.administrative_state = 'enabled'
     and snapshot_row.route_contract_id = new.adapter_contract_id
     and snapshot_row.route_contract_version = new.adapter_contract_version
     and snapshot_row.route_declaration_revision =
        new.adapter_declaration_revision
     and snapshot_row.route_surface_id = new.adapter_surface_id
     and snapshot_row.route_loaded_by_trusted_service_id =
        new.adapter_loaded_by_trusted_service_id
     and snapshot_row.route_loaded_at = new.adapter_loaded_at
     and row(
       head_row.runtime_health_state,
       head_row.runtime_health_revision,
       head_row.runtime_health_checked_at,
       head_row.runtime_diagnostic_code_id,
       head_row.runtime_diagnostic_retryable,
       head_row.runtime_diagnostic_correlation_token,
       head_row.runtime_diagnostic_safe_operator_hint_id
     ) is not distinct from row(
       snapshot_row.runtime_health_state,
       snapshot_row.runtime_health_revision,
       snapshot_row.runtime_health_checked_at,
       snapshot_row.runtime_diagnostic_code_id,
       snapshot_row.runtime_diagnostic_retryable,
       snapshot_row.runtime_diagnostic_correlation_token,
       snapshot_row.runtime_diagnostic_safe_operator_hint_id
     )
     and new.runtime_observation_snapshot #>> '{state}' =
        snapshot_row.runtime_health_state::text
     and new.runtime_observation_snapshot #>> '{revision}' =
        snapshot_row.runtime_health_revision::text
     and (new.runtime_observation_snapshot #>> '{observedAt}')::timestamptz =
        snapshot_row.runtime_health_checked_at
     and (
       (
         snapshot_row.runtime_diagnostic_code_id is null
         and snapshot_row.runtime_diagnostic_retryable is null
         and snapshot_row.runtime_diagnostic_correlation_token is null
         and snapshot_row.runtime_diagnostic_safe_operator_hint_id is null
         and new.runtime_observation_snapshot #> '{diagnostic}' = 'null'::jsonb
       )
       or (
         snapshot_row.runtime_diagnostic_code_id =
           new.runtime_observation_snapshot #>> '{diagnostic,codeId}'
         and snapshot_row.runtime_diagnostic_retryable =
           (new.runtime_observation_snapshot #>>
             '{diagnostic,retryable}')::boolean
         and snapshot_row.runtime_diagnostic_correlation_token =
           new.runtime_observation_snapshot #>>
             '{diagnostic,correlationToken}'
         and snapshot_row.runtime_diagnostic_safe_operator_hint_id is not
           distinct from new.runtime_observation_snapshot #>>
             '{diagnostic,safeOperatorHintId}'
       )
     )
     and snapshot_row.route_descriptor_schema_id =
        new.route_descriptor_snapshot #>> '{descriptorSchemaId}'
     and snapshot_row.route_descriptor_version =
        new.route_descriptor_snapshot #>> '{descriptorVersion}'
     and snapshot_row.route_descriptor_revision::text =
        new.route_descriptor_snapshot #>> '{descriptorRevision}'
     and snapshot_row.route_destination_kind_id =
        new.route_descriptor_snapshot #>> '{destinationKindId}'
     and snapshot_row.route_destination_subject =
        new.route_descriptor_snapshot #>> '{destinationSubject}'
     and snapshot_row.route_descriptor_digest_sha256 =
        new.route_descriptor_digest_sha256
     and jsonb_typeof(new.route_descriptor_snapshot #> '{attributes}') = 'array'
     and jsonb_array_length(new.route_descriptor_snapshot #> '{attributes}') =
        snapshot_row.route_attribute_count
     and not exists (
       select 1
         from jsonb_array_elements(
           new.route_descriptor_snapshot #> '{attributes}'
         ) with ordinality as supplied_attribute(value, ordinal)
         left join public.inbox_v2_source_thread_binding_route_attributes
           stored_attribute
           on stored_attribute.tenant_id = snapshot_row.tenant_id
          and stored_attribute.binding_id = snapshot_row.binding_id
          and stored_attribute.route_descriptor_revision =
             snapshot_row.route_descriptor_revision
          and stored_attribute.ordinal = supplied_attribute.ordinal - 1
        where stored_attribute.ordinal is null
           or supplied_attribute.value is distinct from jsonb_build_object(
             'attributeId', stored_attribute.attribute_id,
             'value', stored_attribute.value
           )
     )
     and snapshot_row.updated_at <= new.created_at
   for share of snapshot_row, head_row;

  if not found then
    raise exception using
      errcode = '40001',
      message = 'inbox_v2.outbound_route_binding_fence_conflict';
  end if;

  perform 1
    from public.inbox_v2_thread_route_policy_versions policy_row
    join public.inbox_v2_thread_route_policy_heads policy_head
      on policy_head.tenant_id = policy_row.tenant_id
     and policy_head.policy_id = policy_row.policy_id
     and policy_head.revision = policy_row.revision
     and policy_head.conversation_id = policy_row.conversation_id
     and policy_head.external_thread_id = policy_row.external_thread_id
     and policy_head.operation_id = policy_row.operation_id
     and policy_head.content_kind_id is not distinct from policy_row.content_kind_id
   where policy_row.tenant_id = new.tenant_id
     and policy_row.policy_id = new.route_policy_id
     and policy_row.revision = new.route_policy_revision
     and policy_row.conversation_id = new.conversation_id
     and policy_row.external_thread_id = new.external_thread_id
     and policy_row.operation_id = new.operation_id
     and policy_row.content_kind_id is not distinct from new.content_kind_id
     and policy_row.required_conversation_permission_id =
        new.required_conversation_permission_id
     and policy_row.updated_at <= new.created_at
     and (
       new.selection_reason <> 'preferred_binding'
       or policy_row.preferred_binding_id = new.source_thread_binding_id
     )
     and (
       new.selection_reason <> 'policy_fallback'
       or exists (
         select 1
           from public.inbox_v2_thread_route_policy_fallback_bindings fallback_row
          where fallback_row.tenant_id = new.tenant_id
            and fallback_row.policy_id = new.route_policy_id
            and fallback_row.policy_revision = new.route_policy_revision
            and fallback_row.ordinal = new.fallback_policy_ordinal
            and fallback_row.external_thread_id = new.external_thread_id
            and fallback_row.binding_id = new.source_thread_binding_id
            and fallback_row.source_connection_id = new.source_connection_id
            and fallback_row.source_account_id = new.source_account_id
       )
     )
   for share of policy_row, policy_head;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.outbound_route_policy_mismatch';
  end if;

  if new.selection_intent_kind = 'explicit_occurrence' and not exists (
    select 1
      from public.inbox_v2_source_occurrences occurrence_row
     where occurrence_row.tenant_id = new.tenant_id
       and occurrence_row.id =
          new.selection_intent_snapshot #>> '{occurrence,id}'
       and occurrence_row.conversation_id = new.conversation_id
       and occurrence_row.external_thread_id = new.external_thread_id
       and occurrence_row.source_thread_binding_id =
          new.source_thread_binding_id
       and occurrence_row.source_connection_id = new.source_connection_id
       and occurrence_row.source_account_id = new.source_account_id
     for share
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.outbound_route_explicit_occurrence_mismatch';
  end if;

  if new.selection_intent_kind = 'explicit_reroute' and not exists (
    select 1
      from public.inbox_v2_outbound_routes original_route
     where original_route.tenant_id = new.tenant_id
       and original_route.id =
          new.selection_intent_snapshot #>> '{originalRoute,id}'
       and original_route.conversation_id = new.conversation_id
       and original_route.external_thread_id = new.external_thread_id
       and original_route.operation_id = new.operation_id
       and original_route.content_kind_id is not distinct from new.content_kind_id
       and original_route.created_at <= new.created_at
     for share
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.outbound_route_explicit_reroute_mismatch';
  end if;

  if new.reference_context_snapshot #>> '{kind}' = 'external_message'
     and not exists (
       select 1
         from public.inbox_v2_external_message_references reference_row
         join public.inbox_v2_source_occurrences occurrence_row
           on occurrence_row.tenant_id = reference_row.tenant_id
          and occurrence_row.id =
             new.reference_context_snapshot #>> '{sourceOccurrence,id}'
          and occurrence_row.external_thread_id = reference_row.external_thread_id
          and occurrence_row.resolution_state = 'resolved'
          and occurrence_row.resolved_external_message_reference_id =
             reference_row.id
         join public.inbox_v2_source_occurrence_resolution_transitions
           resolution_row
           on resolution_row.tenant_id = occurrence_row.tenant_id
          and resolution_row.source_occurrence_id = occurrence_row.id
          and resolution_row.resulting_revision = occurrence_row.revision
          and resolution_row.to_state = 'resolved'
          and resolution_row.resolved_external_message_reference_id =
             reference_row.id
        where reference_row.tenant_id = new.tenant_id
          and reference_row.id =
             new.reference_context_snapshot #>> '{externalMessageReference,id}'
          and reference_row.external_thread_id = new.external_thread_id
          and occurrence_row.source_thread_binding_id =
             new.reference_context_snapshot #>> '{originBinding,id}'
          and occurrence_row.source_account_id =
             new.reference_context_snapshot #>> '{originSourceAccount,id}'
          and occurrence_row.revision =
             (new.reference_context_snapshot #>>
               '{resolutionDecision,occurrenceRevision}')::bigint
          and occurrence_row.binding_generation =
             (new.reference_context_snapshot #>>
               '{resolutionDecision,occurrenceBindingGeneration}')::bigint
          and new.reference_context_snapshot #>>
             '{resolutionDecision,occurrenceDescriptor,descriptorSchemaId}' =
             occurrence_row.descriptor_schema_id
          and new.reference_context_snapshot #>>
             '{resolutionDecision,occurrenceDescriptor,descriptorVersion}' =
             occurrence_row.descriptor_version
          and new.reference_context_snapshot #>>
             '{resolutionDecision,occurrenceDescriptor,capabilityRevision}' =
             occurrence_row.capability_revision::text
          and new.reference_context_snapshot #>>
             '{resolutionDecision,occurrenceDescriptor,descriptorDigestSha256}' =
             occurrence_row.descriptor_digest_sha256
          and jsonb_array_length(new.reference_context_snapshot #>
             '{resolutionDecision,occurrenceDescriptor,providerReferences}') =
             occurrence_row.provider_reference_count
          and not exists (
            select 1
              from jsonb_array_elements(new.reference_context_snapshot #>
                '{resolutionDecision,occurrenceDescriptor,providerReferences}')
                with ordinality as supplied_reference(value, ordinal)
              left join public.inbox_v2_source_occurrence_provider_references
                stored_reference
                on stored_reference.tenant_id = occurrence_row.tenant_id
               and stored_reference.source_occurrence_id = occurrence_row.id
               and stored_reference.ordinal = supplied_reference.ordinal - 1
             where stored_reference.ordinal is null
                or supplied_reference.value is distinct from jsonb_build_object(
                  'kindId', stored_reference.kind_id,
                  'subject', stored_reference.subject
                )
          )
          and new.reference_context_snapshot #> '{portability}' =
             new.reference_context_snapshot #>
               '{resolutionDecision,portability}'
          and new.reference_context_snapshot #>>
             '{portability,adapterContract,contractId}' = new.adapter_contract_id
          and new.reference_context_snapshot #>>
             '{portability,adapterContract,contractVersion}' =
             new.adapter_contract_version
          and new.reference_context_snapshot #>>
             '{portability,adapterContract,declarationRevision}' =
             new.adapter_declaration_revision::text
          and new.reference_context_snapshot #>>
             '{portability,adapterContract,surfaceId}' = new.adapter_surface_id
          and new.reference_context_snapshot #>> '{portability,kind}' =
             occurrence_row.reference_portability_kind::text
          and new.reference_context_snapshot #>>
             '{portability,decisionStrength}' =
             occurrence_row.reference_portability_decision_strength::text
          and occurrence_row.adapter_contract_id = new.adapter_contract_id
          and occurrence_row.adapter_contract_version =
             new.adapter_contract_version
          and occurrence_row.adapter_declaration_revision =
             new.adapter_declaration_revision
          and occurrence_row.adapter_surface_id = new.adapter_surface_id
          and occurrence_row.adapter_loaded_by_trusted_service_id =
             new.adapter_loaded_by_trusted_service_id
          and occurrence_row.adapter_loaded_at = new.adapter_loaded_at
          and new.reference_context_snapshot #>>
             '{resolutionDecision,availabilityObservation,state}' = 'available'
          and new.reference_context_snapshot #>>
             '{resolutionDecision,availabilityObservation,tenantId}' =
             new.tenant_id
          and new.reference_context_snapshot #>
             '{resolutionDecision,availabilityObservation,externalThread}' =
             new.reference_context_snapshot #> '{externalThread}'
          and new.reference_context_snapshot #>
             '{resolutionDecision,availabilityObservation,externalMessageReference}' =
             new.reference_context_snapshot #> '{externalMessageReference}'
          and new.reference_context_snapshot #>
             '{resolutionDecision,availabilityObservation,sourceOccurrence}' =
             new.reference_context_snapshot #> '{sourceOccurrence}'
          and new.reference_context_snapshot #>>
             '{resolutionDecision,availabilityObservation,occurrenceRevision}' =
             occurrence_row.revision::text
          and new.reference_context_snapshot #>>
             '{resolutionDecision,availabilityObservation,occurrenceDescriptorDigestSha256}' =
             occurrence_row.descriptor_digest_sha256
          and new.reference_context_snapshot #>
             '{resolutionDecision,availabilityObservation,adapterContract}' =
             new.adapter_contract_snapshot
          and new.reference_context_snapshot #>>
             '{resolutionDecision,availabilityObservation,observedByTrustedServiceId}' =
             occurrence_row.adapter_loaded_by_trusted_service_id
          and new.reference_context_snapshot #>
             '{resolutionDecision,availabilityObservation,diagnostic}' =
             'null'::jsonb
          and (new.reference_context_snapshot #>>
             '{resolutionDecision,availabilityObservation,observedAt}')::timestamptz
             <= new.selected_at
          and (new.reference_context_snapshot #>>
             '{resolutionDecision,availabilityObservation,notAfter}')::timestamptz
             >= new.selected_at
          and (
            new.reference_context_snapshot #>> '{portability,kind}' <>
              'binding_only'
            or (
              occurrence_row.source_thread_binding_id =
                new.source_thread_binding_id
              and occurrence_row.source_account_id = new.source_account_id
            )
          )
          and (
            new.selection_intent_kind <> 'explicit_occurrence'
            or new.selection_intent_snapshot #>> '{occurrence,id}' =
              occurrence_row.id
          )
          and new.reference_context_snapshot #>>
             '{resolutionDecision,externalThread,id}' =
             new.external_thread_id
          and new.reference_context_snapshot #>>
             '{resolutionDecision,externalMessageReference,id}' =
             reference_row.id
          and new.reference_context_snapshot #>>
             '{resolutionDecision,sourceOccurrence,id}' =
             occurrence_row.id
          and new.reference_context_snapshot #>>
             '{resolutionDecision,originBinding,id}' =
             occurrence_row.source_thread_binding_id
          and new.reference_context_snapshot #>>
             '{resolutionDecision,originSourceAccount,id}' =
             occurrence_row.source_account_id
          and new.reference_context_snapshot #>>
             '{resolutionDecision,loadedByTrustedServiceId}' =
             resolution_row.resolver_trusted_service_id
          and (new.reference_context_snapshot #>>
             '{resolutionDecision,decidedAt}')::timestamptz <= new.selected_at
          and (new.reference_context_snapshot #>>
             '{resolutionDecision,notAfter}')::timestamptz >= new.selected_at
          and new.reference_context_snapshot #>>
             '{resolutionDecision,referenceWindow,state}' <> 'expired'
          and (
            new.reference_context_snapshot #>>
              '{resolutionDecision,referenceWindow,state}' <> 'valid'
            or (new.reference_context_snapshot #>>
              '{resolutionDecision,referenceWindow,notAfter}')::timestamptz >=
              new.selected_at
          )
        for share of reference_row, occurrence_row, resolution_row
     ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.outbound_route_reference_context_mismatch';
  end if;

  if (select count(*) from jsonb_object_keys(
        new.conversation_authorization_snapshot
      )) <> 12
     or (select count(*) from jsonb_object_keys(
        new.source_account_authorization_snapshot
      )) <> 12
     or exists (
       select 1
         from (values
           (new.conversation_authorization_snapshot),
           (new.source_account_authorization_snapshot)
         ) as decision(snapshot)
         cross join lateral jsonb_array_elements(
           decision.snapshot #> '{matchedPermissionIds}'
         ) as permission(value)
        group by decision.snapshot
       having count(*) <> count(distinct permission.value)
          or bool_or(
            jsonb_typeof(permission.value) <> 'string'
            or char_length(permission.value #>> '{}') > 256
            or not (
              (
                permission.value #>> '{}' ~
                  '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
                and char_length(split_part(
                  permission.value #>> '{}', ':', 2
                )) <= 160
              ) or (
                permission.value #>> '{}' ~
                  '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
                and char_length(split_part(
                  permission.value #>> '{}', ':', 2
                )) <= 80
                and char_length(split_part(
                  permission.value #>> '{}', ':', 3
                )) <= 160
                and split_part(permission.value #>> '{}', ':', 2) not in (
                  'core', 'hulee', 'module', 'platform', 'system'
                )
              )
            )
          )
     ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.outbound_route_authorization_snapshot_invalid';
  end if;

  return new;
end;
$function$;

create or replace function public.inbox_v2_tm_outbound_route_action_valid(
  expected_tenant_id text,
  expected_route_id text,
  expected_message_id text,
  expected_reference_owner_message_id text,
  expected_conversation_id text,
  expected_authority_at timestamptz,
  expected_attribution_created_at timestamptz,
  expected_operation_id text,
  expected_required_permission_id text,
  expected_external_message_reference_id text,
  expected_source_occurrence_id text,
  expected_source_account_id text,
  expected_source_thread_binding_id text,
  expected_binding_generation bigint,
  expected_adapter_contract_id text,
  expected_adapter_contract_version text,
  expected_adapter_declaration_revision bigint,
  expected_adapter_surface_id text,
  expected_adapter_loaded_by_trusted_service_id text,
  expected_adapter_loaded_at timestamptz,
  expected_capability_id text,
  expected_capability_revision bigint,
  expected_attribution_id text,
  require_explicit_occurrence boolean
)
returns boolean
language plpgsql
stable
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  return exists (
    select 1
      from public.inbox_v2_outbound_routes route_row
      join public.inbox_v2_action_attributions attribution_row
        on attribution_row.tenant_id = route_row.tenant_id
       and attribution_row.id = expected_attribution_id
       and attribution_row.conversation_id = route_row.conversation_id
      join public.inbox_v2_messages message_row
        on message_row.tenant_id = route_row.tenant_id
       and message_row.id = expected_message_id
       and message_row.conversation_id = route_row.conversation_id
      join public.inbox_v2_source_thread_binding_snapshots binding_snapshot
        on binding_snapshot.tenant_id = route_row.tenant_id
       and binding_snapshot.binding_id = route_row.source_thread_binding_id
       and binding_snapshot.revision = route_row.binding_revision
       and binding_snapshot.external_thread_id = route_row.external_thread_id
       and binding_snapshot.source_connection_id = route_row.source_connection_id
       and binding_snapshot.source_account_id = route_row.source_account_id
       and binding_snapshot.account_generation = route_row.account_generation
       and binding_snapshot.binding_generation = route_row.binding_generation
       and binding_snapshot.remote_access_revision =
         route_row.remote_access_revision
       and binding_snapshot.administrative_revision =
         route_row.administrative_revision
       and binding_snapshot.capability_revision = route_row.capability_revision
       and binding_snapshot.route_descriptor_revision =
         route_row.route_descriptor_revision
      left join public.inbox_v2_source_occurrences occurrence_row
        on occurrence_row.tenant_id = route_row.tenant_id
       and occurrence_row.id = expected_source_occurrence_id
       and occurrence_row.conversation_id = route_row.conversation_id
       and occurrence_row.external_thread_id = route_row.external_thread_id
       and occurrence_row.adapter_contract_id = route_row.adapter_contract_id
       and occurrence_row.adapter_contract_version =
         route_row.adapter_contract_version
       and occurrence_row.adapter_declaration_revision =
         route_row.adapter_declaration_revision
       and occurrence_row.adapter_surface_id = route_row.adapter_surface_id
       and occurrence_row.adapter_loaded_by_trusted_service_id =
         route_row.adapter_loaded_by_trusted_service_id
       and occurrence_row.adapter_loaded_at = route_row.adapter_loaded_at
       and occurrence_row.resolution_state = 'resolved'
       and occurrence_row.resolved_external_message_reference_id =
         expected_external_message_reference_id
      left join public.inbox_v2_source_occurrence_resolution_transitions
        resolution_row
        on resolution_row.tenant_id = occurrence_row.tenant_id
       and resolution_row.source_occurrence_id = occurrence_row.id
       and resolution_row.resulting_revision = occurrence_row.revision
       and resolution_row.to_state = 'resolved'
       and resolution_row.resolved_external_message_reference_id =
         expected_external_message_reference_id
      left join public.inbox_v2_external_message_references reference_row
        on reference_row.tenant_id = route_row.tenant_id
       and reference_row.id = expected_external_message_reference_id
       and reference_row.external_thread_id = route_row.external_thread_id
      left join public.inbox_v2_source_thread_binding_capability_entries capability_row
        on capability_row.tenant_id = route_row.tenant_id
       and capability_row.binding_id = route_row.source_thread_binding_id
       and capability_row.materialized_by_binding_revision =
         route_row.binding_revision
       and capability_row.capability_revision = route_row.capability_revision
       and (
         expected_capability_id is null
         or capability_row.capability_id = expected_capability_id
       )
       and capability_row.operation_id = route_row.operation_id
       and capability_row.content_kind_id is not distinct from
         route_row.content_kind_id
     where route_row.tenant_id = expected_tenant_id
       and route_row.id = expected_route_id
       and route_row.conversation_id = expected_conversation_id
       and route_row.operation_id = expected_operation_id
       and route_row.required_conversation_permission_id =
         expected_required_permission_id
       and (
         expected_source_account_id is null
         or route_row.source_account_id = expected_source_account_id
       )
       and (
         expected_source_thread_binding_id is null
         or route_row.source_thread_binding_id =
           expected_source_thread_binding_id
       )
       and (
         expected_binding_generation is null
         or route_row.binding_generation = expected_binding_generation
       )
       and (
         expected_adapter_contract_id is null
         or (
           route_row.adapter_contract_id = expected_adapter_contract_id
           and route_row.adapter_contract_version =
             expected_adapter_contract_version
           and route_row.adapter_declaration_revision =
             expected_adapter_declaration_revision
           and route_row.adapter_surface_id = expected_adapter_surface_id
           and route_row.adapter_loaded_by_trusted_service_id =
             expected_adapter_loaded_by_trusted_service_id
           and route_row.adapter_loaded_at = expected_adapter_loaded_at
         )
       )
       and (
         expected_capability_revision is null
         or route_row.capability_revision = expected_capability_revision
       )
       and binding_snapshot.remote_access_state = 'active'
       and binding_snapshot.administrative_state = 'enabled'
       and binding_snapshot.runtime_health_state::text =
         route_row.runtime_observation_snapshot #>> '{state}'
       and binding_snapshot.runtime_health_revision::text =
         route_row.runtime_observation_snapshot #>> '{revision}'
       and binding_snapshot.runtime_health_checked_at =
         (route_row.runtime_observation_snapshot #>>
           '{observedAt}')::timestamptz
       and binding_snapshot.capability_contract_id =
         route_row.adapter_contract_id
       and binding_snapshot.capability_contract_version =
         route_row.adapter_contract_version
       and binding_snapshot.capability_declaration_revision =
         route_row.adapter_declaration_revision
       and binding_snapshot.capability_surface_id = route_row.adapter_surface_id
       and binding_snapshot.capability_loaded_by_trusted_service_id =
         route_row.adapter_loaded_by_trusted_service_id
       and binding_snapshot.capability_loaded_at = route_row.adapter_loaded_at
       and binding_snapshot.updated_at <= expected_authority_at
       and binding_snapshot.capability_captured_at <= expected_authority_at
       and (
         (
           expected_external_message_reference_id is null
           and expected_source_occurrence_id is null
           and route_row.reference_context_snapshot =
             '{"kind":"none"}'::jsonb
         )
         or (
           expected_external_message_reference_id is not null
           and expected_source_occurrence_id is not null
           and occurrence_row.id is not null
           and reference_row.id is not null
           and resolution_row.id is not null
           and (
             expected_reference_owner_message_id is null
             or reference_row.message_id =
               expected_reference_owner_message_id
           )
           and route_row.reference_context_snapshot #>> '{kind}' =
             'external_message'
           and route_row.reference_context_snapshot #>>
             '{externalMessageReference,id}' =
               expected_external_message_reference_id
           and route_row.reference_context_snapshot #>>
             '{sourceOccurrence,id}' = expected_source_occurrence_id
           and route_row.reference_context_snapshot #>>
             '{externalThread,id}' = route_row.external_thread_id
           and route_row.reference_context_snapshot #>>
             '{originBinding,id}' = occurrence_row.source_thread_binding_id
           and route_row.reference_context_snapshot #>>
             '{originSourceAccount,id}' = occurrence_row.source_account_id
           and route_row.reference_context_snapshot #>
             '{resolutionDecision,externalThread}' =
               route_row.reference_context_snapshot #> '{externalThread}'
           and route_row.reference_context_snapshot #>
             '{resolutionDecision,externalMessageReference}' =
               route_row.reference_context_snapshot #>
                 '{externalMessageReference}'
           and route_row.reference_context_snapshot #>
             '{resolutionDecision,sourceOccurrence}' =
               route_row.reference_context_snapshot #> '{sourceOccurrence}'
           and route_row.reference_context_snapshot #>
             '{resolutionDecision,originBinding}' =
               route_row.reference_context_snapshot #> '{originBinding}'
           and route_row.reference_context_snapshot #>
             '{resolutionDecision,originSourceAccount}' =
               route_row.reference_context_snapshot #> '{originSourceAccount}'
           and route_row.reference_context_snapshot #>
             '{resolutionDecision,portability}' =
               route_row.reference_context_snapshot #> '{portability}'
           and occurrence_row.revision =
             (route_row.reference_context_snapshot #>>
               '{resolutionDecision,occurrenceRevision}')::bigint
           and occurrence_row.binding_generation =
             (route_row.reference_context_snapshot #>>
               '{resolutionDecision,occurrenceBindingGeneration}')::bigint
           and route_row.reference_context_snapshot #>>
             '{resolutionDecision,occurrenceDescriptor,descriptorSchemaId}' =
               occurrence_row.descriptor_schema_id
           and route_row.reference_context_snapshot #>>
             '{resolutionDecision,occurrenceDescriptor,descriptorVersion}' =
               occurrence_row.descriptor_version
           and route_row.reference_context_snapshot #>>
             '{resolutionDecision,occurrenceDescriptor,capabilityRevision}' =
               occurrence_row.capability_revision::text
           and route_row.reference_context_snapshot #>>
             '{resolutionDecision,occurrenceDescriptor,descriptorDigestSha256}' =
               occurrence_row.descriptor_digest_sha256
           and jsonb_array_length(route_row.reference_context_snapshot #>
             '{resolutionDecision,occurrenceDescriptor,providerReferences}') =
               occurrence_row.provider_reference_count
           and not exists (
             select 1
               from jsonb_array_elements(route_row.reference_context_snapshot #>
                 '{resolutionDecision,occurrenceDescriptor,providerReferences}')
                 with ordinality as supplied_reference(value, ordinal)
               left join public.inbox_v2_source_occurrence_provider_references
                 stored_reference
                 on stored_reference.tenant_id = occurrence_row.tenant_id
                and stored_reference.source_occurrence_id = occurrence_row.id
                and stored_reference.ordinal = supplied_reference.ordinal - 1
              where stored_reference.ordinal is null
                 or supplied_reference.value is distinct from jsonb_build_object(
                   'kindId', stored_reference.kind_id,
                   'subject', stored_reference.subject
                 )
           )
           and route_row.reference_context_snapshot #>>
             '{portability,kind}' =
               occurrence_row.reference_portability_kind::text
           and route_row.reference_context_snapshot #>>
             '{portability,decisionStrength}' =
               occurrence_row.reference_portability_decision_strength::text
           and route_row.reference_context_snapshot #>
             '{portability,adapterContract}' =
               route_row.adapter_contract_snapshot
           and route_row.reference_context_snapshot #>>
             '{resolutionDecision,loadedByTrustedServiceId}' =
               resolution_row.resolver_trusted_service_id
           and route_row.reference_context_snapshot #>>
             '{resolutionDecision,availabilityObservation,state}' = 'available'
           and route_row.reference_context_snapshot #>>
             '{resolutionDecision,availabilityObservation,tenantId}' =
               route_row.tenant_id
           and route_row.reference_context_snapshot #>
             '{resolutionDecision,availabilityObservation,externalThread}' =
               route_row.reference_context_snapshot #> '{externalThread}'
           and route_row.reference_context_snapshot #>
             '{resolutionDecision,availabilityObservation,externalMessageReference}' =
               route_row.reference_context_snapshot #>
                 '{externalMessageReference}'
           and route_row.reference_context_snapshot #>
             '{resolutionDecision,availabilityObservation,sourceOccurrence}' =
               route_row.reference_context_snapshot #> '{sourceOccurrence}'
           and route_row.reference_context_snapshot #>>
             '{resolutionDecision,availabilityObservation,occurrenceRevision}' =
               occurrence_row.revision::text
           and route_row.reference_context_snapshot #>>
             '{resolutionDecision,availabilityObservation,occurrenceDescriptorDigestSha256}' =
               occurrence_row.descriptor_digest_sha256
           and route_row.reference_context_snapshot #>
             '{resolutionDecision,availabilityObservation,adapterContract}' =
               route_row.adapter_contract_snapshot
           and route_row.reference_context_snapshot #>>
             '{resolutionDecision,availabilityObservation,observedByTrustedServiceId}' =
               occurrence_row.adapter_loaded_by_trusted_service_id
           and route_row.reference_context_snapshot #>
             '{resolutionDecision,availabilityObservation,diagnostic}' =
               'null'::jsonb
           and (route_row.reference_context_snapshot #>>
             '{resolutionDecision,availabilityObservation,observedAt}')::timestamptz
               <= expected_authority_at
           and (route_row.reference_context_snapshot #>>
             '{resolutionDecision,availabilityObservation,notAfter}')::timestamptz
               >= expected_authority_at
           and (
             route_row.reference_context_snapshot #>>
               '{portability,kind}' <> 'binding_only'
             or (
               occurrence_row.source_thread_binding_id =
                 route_row.source_thread_binding_id
               and occurrence_row.source_account_id =
                 route_row.source_account_id
               and occurrence_row.binding_generation =
                 route_row.binding_generation
             )
           )
           and (
             route_row.selection_intent_kind <> 'explicit_occurrence'
             or (
               route_row.selection_reason = 'explicit_occurrence'
               and route_row.selection_intent_snapshot #>>
                 '{occurrence,id}' = occurrence_row.id
               and occurrence_row.source_thread_binding_id =
                 route_row.source_thread_binding_id
               and occurrence_row.source_account_id =
                 route_row.source_account_id
               and occurrence_row.binding_generation =
                 route_row.binding_generation
             )
           )
         )
       )
       and (
         not require_explicit_occurrence
         or (
           route_row.selection_intent_kind = 'explicit_occurrence'
           and route_row.selection_reason = 'explicit_occurrence'
           and route_row.selection_intent_snapshot #>> '{occurrence,id}' =
             expected_source_occurrence_id
         )
       )
       and attribution_row.created_at = expected_attribution_created_at
       and attribution_row.source_occurrence_id is null
       and (
         (
           attribution_row.app_actor_kind = 'employee'
           and route_row.principal_kind = 'employee'
           and route_row.principal_employee_id =
             attribution_row.app_actor_employee_id
           and route_row.authorization_epoch =
             attribution_row.app_authorization_epoch
           and attribution_row.app_trusted_service_id is null
         )
         or (
           attribution_row.app_actor_kind = 'trusted_service'
           and route_row.principal_kind = 'trusted_service'
           and route_row.principal_trusted_service_id =
             attribution_row.app_trusted_service_id
           and attribution_row.app_actor_employee_id is null
           and attribution_row.app_authorization_epoch is null
         )
       )
       and capability_row.state = 'supported'
       and (
         capability_row.valid_until is null
         or capability_row.valid_until >= expected_authority_at
       )
       and not exists (
         select 1
           from public.inbox_v2_source_thread_binding_capability_required_roles
             required_role
          where required_role.tenant_id = capability_row.tenant_id
            and required_role.binding_id = capability_row.binding_id
            and required_role.capability_revision =
              capability_row.capability_revision
            and required_role.capability_ordinal = capability_row.ordinal
            and not exists (
              select 1
                from public.inbox_v2_source_thread_binding_provider_roles
                  provider_role
               where provider_role.tenant_id = required_role.tenant_id
                 and provider_role.binding_id = required_role.binding_id
                 and provider_role.provider_access_revision =
                   binding_snapshot.provider_access_revision
                 and provider_role.provider_role_id =
                   required_role.provider_role_id
            )
       )
       and (route_row.runtime_observation_snapshot #>>
         '{observedAt}')::timestamptz <= expected_authority_at
       and route_row.selected_at <= expected_authority_at
       and route_row.created_at <= expected_authority_at
       and route_row.candidate_snapshot_not_after >= expected_authority_at
       and (route_row.conversation_authorization_snapshot #>>
         '{notAfter}')::timestamptz >= expected_authority_at
       and (route_row.source_account_authorization_snapshot #>>
         '{notAfter}')::timestamptz >= expected_authority_at
       and (
         expected_external_message_reference_id is null
         or (
           (route_row.reference_context_snapshot #>>
             '{resolutionDecision,notAfter}')::timestamptz >=
               expected_authority_at
           and route_row.reference_context_snapshot #>>
             '{resolutionDecision,referenceWindow,state}' <> 'expired'
           and (
             route_row.reference_context_snapshot #>>
               '{resolutionDecision,referenceWindow,state}' <> 'valid'
             or (route_row.reference_context_snapshot #>>
               '{resolutionDecision,referenceWindow,notAfter}')::timestamptz >=
                 expected_authority_at
           )
         )
       )
  );
exception when others then
  return false;
end;
$function$;

create or replace function public.inbox_v2_tm_assert_reference_context(
  tenant_key text,
  message_key text
)
returns void
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  message_kind public.inbox_v2_message_reference_kind;
  context_kind public.inbox_v2_message_reference_context_kind;
  provenance public.inbox_v2_provider_forward_provenance;
  message_origin public.inbox_v2_message_origin_kind;
  message_conversation_id text;
  canonical_count integer;
  external_count integer;
  unresolved_count integer;
begin
  select message_row.reference_kind, context_row.kind,
         context_row.provenance_completeness, message_row.origin_kind,
         message_row.conversation_id
    into message_kind, context_kind, provenance, message_origin,
         message_conversation_id
    from public.inbox_v2_messages message_row
    left join public.inbox_v2_message_reference_contexts context_row
      on context_row.tenant_id = message_row.tenant_id
     and context_row.message_id = message_row.id
   where message_row.tenant_id = tenant_key
     and message_row.id = message_key;

  if context_kind is null then
    raise exception using errcode = '23514',
      message = 'inbox_v2.message_reference_context_missing';
  end if;

  select count(*) into canonical_count
    from public.inbox_v2_message_reference_canonical_targets
   where tenant_id = tenant_key and message_id = message_key;
  select count(*) into external_count
    from public.inbox_v2_message_reference_external_targets
   where tenant_id = tenant_key and message_id = message_key;
  select count(*) into unresolved_count
    from public.inbox_v2_message_reference_unresolved_targets
   where tenant_id = tenant_key and message_id = message_key;

  if not (
    (message_kind = 'none' and context_kind = 'none'
      and canonical_count = 0 and external_count = 0 and unresolved_count = 0)
    or (message_kind = 'reply_resolved_internal' and context_kind = 'reply'
      and canonical_count = 1 and external_count = 0 and unresolved_count = 0)
    or (message_kind = 'reply_resolved_external' and context_kind = 'reply'
      and canonical_count = 1 and external_count = 1 and unresolved_count = 0)
    or (message_kind = 'reply_unresolved_source' and context_kind = 'reply'
      and canonical_count = 0 and external_count = 0 and unresolved_count = 1)
    or (message_kind = 'forward_content_copy'
      and context_kind = 'forward_content_copy'
      and canonical_count between 1 and 32
      and external_count = 0 and unresolved_count = 0)
    or (message_kind = 'forward_provider_native'
      and context_kind = 'forward_provider_native'
      and external_count = 1
      and canonical_count = 0 and unresolved_count = 0)
    or (message_kind = 'forward_provider_observed'
      and context_kind = 'forward_provider_observed'
      and external_count between 0 and 32
      and canonical_count = 0 and unresolved_count = 0
      and (provenance <> 'exact' or external_count >= 1))
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.message_reference_context_shape';
  end if;

  if exists (
    select 1
      from public.inbox_v2_message_reference_canonical_targets target_row
     where target_row.tenant_id = tenant_key
       and target_row.message_id = message_key
       and target_row.target_message_id = message_key
  ) or exists (
    select 1
      from public.inbox_v2_message_reference_external_targets target_row
      join public.inbox_v2_external_message_references reference_row
        on reference_row.tenant_id = target_row.tenant_id
       and reference_row.id = target_row.external_message_reference_id
     where target_row.tenant_id = tenant_key
       and target_row.message_id = message_key
       and reference_row.message_id = message_key
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.message_reference_self_target';
  end if;

  if message_kind in ('reply_resolved_internal', 'reply_resolved_external')
     and exists (
       select 1
         from public.inbox_v2_message_reference_canonical_targets target_row
         join public.inbox_v2_messages target_message
           on target_message.tenant_id = target_row.tenant_id
          and target_message.id = target_row.target_message_id
        where target_row.tenant_id = tenant_key
          and target_row.message_id = message_key
          and target_message.conversation_id <> message_conversation_id
     ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.message_reply_target_conversation_mismatch';
  end if;

  if message_kind = 'reply_resolved_external' and not exists (
    select 1
      from public.inbox_v2_message_reference_canonical_targets canonical_row
      join public.inbox_v2_message_reference_external_targets external_row
        on external_row.tenant_id = canonical_row.tenant_id
       and external_row.message_id = canonical_row.message_id
      join public.inbox_v2_external_message_references reference_row
        on reference_row.tenant_id = external_row.tenant_id
       and reference_row.id = external_row.external_message_reference_id
       and reference_row.message_id = canonical_row.target_message_id
       and reference_row.timeline_item_id = canonical_row.target_timeline_item_id
     where canonical_row.tenant_id = tenant_key
       and canonical_row.message_id = message_key
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.message_reply_target_identity_mismatch';
  end if;

  if message_kind = 'forward_content_copy'
     and message_origin = 'hulee_external' then
    perform 1
      from public.inbox_v2_message_reference_canonical_targets canonical_row
      join public.inbox_v2_message_revisions source_revision
        on source_revision.tenant_id = canonical_row.tenant_id
       and source_revision.message_id = canonical_row.target_message_id
       and source_revision.timeline_item_id =
         canonical_row.target_timeline_item_id
       and source_revision.message_revision =
         canonical_row.target_message_revision
      join public.inbox_v2_messages source_message
        on source_message.tenant_id = source_revision.tenant_id
       and source_message.id = source_revision.message_id
       and source_message.timeline_item_id = source_revision.timeline_item_id
       and source_message.revision = source_revision.message_revision
       and source_message.lifecycle = 'active'
       and source_message.content_id = source_revision.after_content_id
       and source_message.content_revision =
         source_revision.after_content_revision
       and source_message.content_state = source_revision.after_content_state
      join public.inbox_v2_timeline_contents source_content
        on source_content.tenant_id = source_message.tenant_id
       and source_content.id = source_message.content_id
       and source_content.owner_kind = 'message'
       and source_content.owner_id = source_message.id
       and source_content.revision = source_message.content_revision
       and source_content.state = 'available'
      join public.inbox_v2_messages destination_message
        on destination_message.tenant_id = canonical_row.tenant_id
       and destination_message.id = canonical_row.message_id
       and destination_message.origin_kind = 'hulee_external'
      join public.inbox_v2_timeline_contents destination_content
        on destination_content.tenant_id = destination_message.tenant_id
       and destination_content.id = destination_message.content_id
       and destination_content.owner_kind = 'message'
       and destination_content.owner_id = destination_message.id
       and destination_content.revision = destination_message.content_revision
       and destination_content.state = 'available'
     where canonical_row.tenant_id = tenant_key
       and canonical_row.message_id = message_key
       and canonical_count = 1
       and source_revision.after_content_state = 'available'
       and source_content.content_digest_sha256 is not null
       and destination_content.content_digest_sha256 is not null
       -- Content-copy preserves every ordered semantic field and immutable
       -- file/object pin. MessageAttachment ids are deliberately excluded:
       -- they are owner-scoped anchors and the destination must receive a new
       -- one. Keeping the comparison relational lets PostgreSQL validate the
       -- copy independently from the application-level normalized digest.
       and (
         select coalesce(
           jsonb_agg(
             to_jsonb(source_payload) - array[
               'content_id', 'content_revision', 'attachment_id', 'created_at'
             ]::text[]
             order by source_payload.ordinal
           ),
           '[]'::jsonb
         )
           from public.inbox_v2_timeline_content_payloads source_payload
          where source_payload.tenant_id = source_content.tenant_id
            and source_payload.content_id = source_content.id
            and source_payload.content_revision = source_content.revision
       ) = (
         select coalesce(
           jsonb_agg(
             to_jsonb(destination_payload) - array[
               'content_id', 'content_revision', 'attachment_id', 'created_at'
             ]::text[]
             order by destination_payload.ordinal
           ),
           '[]'::jsonb
         )
           from public.inbox_v2_timeline_content_payloads destination_payload
          where destination_payload.tenant_id = destination_content.tenant_id
            and destination_payload.content_id = destination_content.id
            and destination_payload.content_revision =
              destination_content.revision
       )
       and (
         select coalesce(
           jsonb_agg(
             to_jsonb(source_value) - array[
               'content_id', 'content_revision'
             ]::text[]
             order by source_value.block_ordinal, source_value.value_ordinal
           ),
           '[]'::jsonb
         )
           from public.inbox_v2_timeline_content_contact_values source_value
          where source_value.tenant_id = source_content.tenant_id
            and source_value.content_id = source_content.id
            and source_value.content_revision = source_content.revision
       ) = (
         select coalesce(
           jsonb_agg(
             to_jsonb(destination_value) - array[
               'content_id', 'content_revision'
             ]::text[]
             order by destination_value.block_ordinal,
                      destination_value.value_ordinal
           ),
           '[]'::jsonb
         )
           from public.inbox_v2_timeline_content_contact_values destination_value
          where destination_value.tenant_id = destination_content.tenant_id
            and destination_value.content_id = destination_content.id
            and destination_value.content_revision =
              destination_content.revision
       )
       and not exists (
         select 1
           from public.inbox_v2_timeline_content_payloads source_payload
           join public.inbox_v2_timeline_content_payloads destination_payload
             on destination_payload.tenant_id = source_payload.tenant_id
            and destination_payload.content_id = destination_content.id
            and destination_payload.content_revision =
              destination_content.revision
            and destination_payload.attachment_id =
              source_payload.attachment_id
          where source_payload.tenant_id = source_content.tenant_id
            and source_payload.content_id = source_content.id
            and source_payload.content_revision = source_content.revision
            and source_payload.attachment_id is not null
       )
     for share of source_message, source_content;

    if not found then
      raise exception using errcode = '23514',
        message = 'inbox_v2.message_content_copy_source_drift';
    end if;
  end if;

  if exists (
    select 1
      from public.inbox_v2_message_reference_external_targets target_row
      left join public.inbox_v2_source_occurrences occurrence_row
        on occurrence_row.tenant_id = target_row.tenant_id
       and occurrence_row.id = target_row.source_occurrence_id
      left join public.inbox_v2_external_message_references reference_row
        on reference_row.tenant_id = target_row.tenant_id
       and reference_row.id = target_row.external_message_reference_id
     where target_row.tenant_id = tenant_key
       and target_row.message_id = message_key
       and (
         occurrence_row.id is null or reference_row.id is null
         or occurrence_row.resolution_state <> 'resolved'
         or occurrence_row.resolved_external_message_reference_id <>
            target_row.external_message_reference_id
       )
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.message_external_reference_target_invalid';
  end if;

  if exists (
    select 1
      from public.inbox_v2_message_reference_unresolved_targets target_row
      join public.inbox_v2_source_occurrences occurrence_row
        on occurrence_row.tenant_id = target_row.tenant_id
       and occurrence_row.id = target_row.source_occurrence_id
     where target_row.tenant_id = tenant_key
       and target_row.message_id = message_key
       and (
         occurrence_row.message_key_digest_sha256 <>
           target_row.external_message_key_digest_sha256
         or occurrence_row.resolution_state::text <>
           target_row.resolution_state
         or (target_row.resolution_state = 'pending' and exists (
           select 1
             from public.inbox_v2_message_reference_unresolved_candidates candidate_row
            where candidate_row.tenant_id = target_row.tenant_id
              and candidate_row.message_id = target_row.message_id
         ))
         or (target_row.resolution_state = 'conflicted' and (
           select count(*) = occurrence_row.resolution_candidate_count
              and min(candidate_row.ordinal) = 0
              and max(candidate_row.ordinal) =
                occurrence_row.resolution_candidate_count - 1
             from public.inbox_v2_message_reference_unresolved_candidates candidate_row
            where candidate_row.tenant_id = target_row.tenant_id
              and candidate_row.message_id = target_row.message_id
         ) is not true)
       )
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.message_unresolved_reference_invalid';
  end if;

  if exists (
    select 1
      from public.inbox_v2_message_reference_unresolved_candidates candidate_row
      join public.inbox_v2_message_reference_unresolved_targets target_row
        on target_row.tenant_id = candidate_row.tenant_id
       and target_row.message_id = candidate_row.message_id
      left join public.inbox_v2_external_message_references reference_row
        on reference_row.tenant_id = candidate_row.tenant_id
       and reference_row.id = candidate_row.external_message_reference_id
     where candidate_row.tenant_id = tenant_key
       and candidate_row.message_id = message_key
       and (
         reference_row.id is null
         or reference_row.message_key_digest_sha256 <>
           target_row.external_message_key_digest_sha256
       )
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.message_unresolved_candidate_invalid';
  end if;
end;
$function$;

create or replace function public.inbox_v2_tm_core_coherence()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  changed_row jsonb;
  tenant_key text;
  timeline_key text;
  message_key text;
  note_key text;
  content_key text;
  conversation_key text;
  actual_count bigint;
  latest_item record;
begin
  changed_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  tenant_key := changed_row->>'tenant_id';

  if not exists (select 1 from public.tenants where id = tenant_key) then
    return null;
  end if;

  if tg_table_name = 'inbox_v2_timeline_items' then
    timeline_key := changed_row->>'id';
    conversation_key := changed_row->>'conversation_id';
  else
    timeline_key := changed_row->>'timeline_item_id';
  end if;

  if tg_table_name = 'inbox_v2_messages' then
    message_key := changed_row->>'id';
    content_key := changed_row->>'content_id';
    conversation_key := changed_row->>'conversation_id';
  elsif tg_table_name = 'inbox_v2_message_revisions' then
    message_key := changed_row->>'message_id';
  elsif tg_table_name = 'inbox_v2_outbound_dispatches' then
    message_key := changed_row->>'message_id';
  elsif tg_table_name like 'inbox_v2_message_reference_%' then
    message_key := changed_row->>'message_id';
  elsif tg_table_name = 'inbox_v2_staff_notes' then
    note_key := changed_row->>'id';
    content_key := changed_row->>'content_id';
    conversation_key := changed_row->>'conversation_id';
  elsif tg_table_name = 'inbox_v2_staff_note_revisions' then
    note_key := changed_row->>'staff_note_id';
  elsif tg_table_name in (
    'inbox_v2_timeline_contents', 'inbox_v2_timeline_content_revisions',
    'inbox_v2_timeline_content_payloads',
    'inbox_v2_timeline_content_contact_values'
  ) then
    content_key := coalesce(changed_row->>'id', changed_row->>'content_id');
  end if;

  if tg_table_name = 'inbox_v2_outbound_dispatches'
     and tg_op = 'INSERT'
     and not exists (
       select 1
         from public.inbox_v2_messages message_row
        where message_row.tenant_id = tenant_key
          and message_row.id = changed_row->>'message_id'
          and message_row.conversation_id =
            changed_row->>'conversation_id'
          and message_row.timeline_item_id =
            changed_row->>'timeline_item_id'
          and message_row.origin_kind = 'hulee_external'
          and message_row.origin_outbound_route_id = changed_row->>'route_id'
          and message_row.revision = 1
          and message_row.created_at =
            (changed_row->>'created_at')::timestamptz
          and changed_row->>'state' = 'queued'
          and (changed_row->>'attempt_count')::integer = 0
          and (changed_row->>'revision')::bigint = 1
          and (changed_row->>'created_at')::timestamptz =
            (changed_row->>'updated_at')::timestamptz
     ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.message_creation_dispatch_mismatch';
  end if;

  if timeline_key is not null and exists (
    select 1 from public.inbox_v2_timeline_items
     where tenant_id = tenant_key and id = timeline_key
  ) then
    if not exists (
      select 1
        from public.inbox_v2_timeline_items item_row
       where item_row.tenant_id = tenant_key
         and item_row.id = timeline_key
         and (
           (item_row.subject_kind = 'message' and exists (
             select 1 from public.inbox_v2_messages message_row
              where message_row.tenant_id = item_row.tenant_id
                and message_row.id = item_row.subject_id
                and message_row.timeline_item_id = item_row.id
                and message_row.conversation_id = item_row.conversation_id
                and message_row.revision = item_row.revision
           ))
           or (item_row.subject_kind = 'staff_note' and exists (
             select 1 from public.inbox_v2_staff_notes note_row
              where note_row.tenant_id = item_row.tenant_id
                and note_row.id = item_row.subject_id
                and note_row.timeline_item_id = item_row.id
                and note_row.conversation_id = item_row.conversation_id
                and note_row.revision = item_row.revision
           ))
           or (item_row.subject_kind not in ('message', 'staff_note') and exists (
             select 1 from public.inbox_v2_timeline_subject_details detail_row
              where detail_row.tenant_id = item_row.tenant_id
                and detail_row.timeline_item_id = item_row.id
                and detail_row.subject_kind = item_row.subject_kind
                and item_row.subject_id = case detail_row.subject_kind
                  when 'call' then detail_row.source_object_id
                  when 'review' then detail_row.source_object_id
                  when 'module_event' then detail_row.source_object_id
                  when 'participant_change' then detail_row.participant_transition_id
                  when 'work_change' then coalesce(
                    detail_row.work_item_transition_id,
                    detail_row.work_item_relation_transition_id
                  )
                  when 'system_event' then detail_row.system_event_id
                end
                and (
                  detail_row.actor_participant_id is null or exists (
                    select 1 from public.inbox_v2_conversation_participants participant_row
                     where participant_row.tenant_id = item_row.tenant_id
                       and participant_row.id = detail_row.actor_participant_id
                       and participant_row.conversation_id = item_row.conversation_id
                  )
                )
           ))
         )
    ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.timeline_subject_coherence';
    end if;
  end if;

  if message_key is not null and exists (
    select 1 from public.inbox_v2_messages
     where tenant_id = tenant_key and id = message_key
  ) then
    if not exists (
      select 1
        from public.inbox_v2_messages message_row
        join public.inbox_v2_timeline_items item_row
          on item_row.tenant_id = message_row.tenant_id
         and item_row.id = message_row.timeline_item_id
         and item_row.conversation_id = message_row.conversation_id
         and item_row.subject_kind = 'message'
         and item_row.subject_id = message_row.id
         and item_row.revision = message_row.revision
        join public.inbox_v2_timeline_contents content_row
          on content_row.tenant_id = message_row.tenant_id
         and content_row.id = message_row.content_id
         and content_row.owner_kind = 'message'
         and content_row.owner_id = message_row.id
         and content_row.revision = message_row.content_revision
         and content_row.state = message_row.content_state
        join public.inbox_v2_timeline_content_revisions content_revision_row
          on content_revision_row.tenant_id = content_row.tenant_id
         and content_revision_row.content_id = content_row.id
         and content_revision_row.revision = content_row.revision
         and content_revision_row.state = content_row.state
         and content_revision_row.recorded_stream_position =
           content_row.last_changed_stream_position
        join public.inbox_v2_message_revisions revision_row
          on revision_row.tenant_id = message_row.tenant_id
         and revision_row.message_id = message_row.id
         and revision_row.timeline_item_id = message_row.timeline_item_id
         and revision_row.message_revision = message_row.revision
         and revision_row.recorded_stream_position =
           message_row.last_changed_stream_position
        join public.inbox_v2_action_attributions attribution_row
          on attribution_row.tenant_id = message_row.tenant_id
         and attribution_row.id = message_row.creation_attribution_id
         and attribution_row.conversation_id = message_row.conversation_id
        join public.inbox_v2_conversation_participants author_row
          on author_row.tenant_id = message_row.tenant_id
         and author_row.id = message_row.author_participant_id
         and author_row.conversation_id = message_row.conversation_id
        left join public.inbox_v2_source_occurrences origin_occurrence_row
          on origin_occurrence_row.tenant_id = message_row.tenant_id
         and origin_occurrence_row.id = message_row.origin_source_occurrence_id
       where message_row.tenant_id = tenant_key
         and message_row.id = message_key
         and attribution_row.action_participant_id =
           message_row.author_participant_id
         and (
           (message_row.origin_kind = 'source_originated'
             and attribution_row.source_occurrence_id =
               message_row.origin_source_occurrence_id
             and attribution_row.app_actor_kind is null
             and author_row.subject_kind = 'source_external_identity'
             and origin_occurrence_row.provider_actor_kind =
               'source_external_identity'
             and author_row.subject_source_external_identity_id =
               origin_occurrence_row.provider_actor_source_external_identity_id)
           or (message_row.origin_kind in ('hulee_external', 'internal')
             and attribution_row.source_occurrence_id is null
             and (
               (attribution_row.app_actor_kind = 'employee'
                 and author_row.subject_kind = 'employee'
                 and author_row.subject_employee_id =
                   attribution_row.app_actor_employee_id)
               or (attribution_row.app_actor_kind = 'trusted_service'
                 and attribution_row.automation_kind is not null
                 and author_row.subject_kind = 'bot')
             ))
           or (message_row.origin_kind = 'migration'
             and attribution_row.source_occurrence_id is null
             and attribution_row.app_actor_kind = 'trusted_service'
             and attribution_row.automation_kind is not null
             and author_row.subject_kind in ('legacy_unknown', 'system'))
         )
    ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.message_head_coherence';
    end if;

    if not public.inbox_v2_tm_message_history_valid(
      tenant_key,
      message_key
    ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.message_revision_history_coherence';
    end if;

    if exists (
      select 1
        from public.inbox_v2_messages message_row
       where message_row.tenant_id = tenant_key
         and message_row.id = message_key
         and message_row.origin_kind = 'source_originated'
    ) and not exists (
      select 1
        from public.inbox_v2_messages message_row
        join public.inbox_v2_source_occurrences occurrence_row
          on occurrence_row.tenant_id = message_row.tenant_id
         and occurrence_row.id = message_row.origin_source_occurrence_id
         and occurrence_row.conversation_id = message_row.conversation_id
         and occurrence_row.direction::text =
           message_row.origin_source_direction::text
         and occurrence_row.origin_kind not in (
           'provider_echo', 'provider_response'
         )
         and occurrence_row.provider_actor_kind = 'source_external_identity'
         and occurrence_row.resolution_state = 'resolved'
        join public.inbox_v2_external_message_references reference_row
          on reference_row.tenant_id = message_row.tenant_id
         and reference_row.id =
           occurrence_row.resolved_external_message_reference_id
         and reference_row.external_thread_id = occurrence_row.external_thread_id
         and reference_row.conversation_id = message_row.conversation_id
         and reference_row.timeline_item_id = message_row.timeline_item_id
         and reference_row.message_id = message_row.id
         and reference_row.message_key_digest_sha256 =
           occurrence_row.message_key_digest_sha256
         and reference_row.created_at = message_row.created_at
         and reference_row.revision = 1
        join public.inbox_v2_message_transport_links origin_link_row
          on origin_link_row.tenant_id = message_row.tenant_id
         and origin_link_row.message_id = message_row.id
         and origin_link_row.source_occurrence_id = occurrence_row.id
         and origin_link_row.external_message_reference_id = reference_row.id
         and origin_link_row.role = case message_row.origin_source_direction
           when 'inbound' then 'origin'::public.inbox_v2_message_transport_link_role
           when 'outbound' then 'native_outbound'::public.inbox_v2_message_transport_link_role
         end
         and origin_link_row.resulting_head_revision = 1
         and origin_link_row.revision = 1
         and origin_link_row.linked_at = message_row.created_at
        join public.inbox_v2_message_transport_link_heads head_row
          on head_row.tenant_id = message_row.tenant_id
         and head_row.message_id = message_row.id
         and head_row.link_count >= 1
         and head_row.revision = head_row.link_count
         and head_row.updated_at >= message_row.created_at
       where message_row.tenant_id = tenant_key
         and message_row.id = message_key
         and public.inbox_v2_tm_transport_occurrence_link_valid(
           origin_link_row.tenant_id,
           origin_link_row.id
         )
    ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.message_source_origin_transport_coherence';
    end if;

    if exists (
      select 1
        from public.inbox_v2_messages message_row
        join public.inbox_v2_message_transport_links link_row
          on link_row.tenant_id = message_row.tenant_id
         and link_row.message_id = message_row.id
       where message_row.tenant_id = tenant_key
         and message_row.id = message_key
         and message_row.origin_kind in ('internal', 'migration')
    ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.message_local_transport_link_forbidden';
    end if;

    if exists (
      select 1
        from public.inbox_v2_messages message_row
        left join public.inbox_v2_message_reference_contexts context_row
          on context_row.tenant_id = message_row.tenant_id
         and context_row.message_id = message_row.id
        left join lateral (
          select count(*)::integer as target_count,
                 min(target_row.external_message_reference_id) as
                   external_message_reference_id,
                 min(target_row.source_occurrence_id) as source_occurrence_id
            from public.inbox_v2_message_reference_external_targets target_row
           where target_row.tenant_id = message_row.tenant_id
             and target_row.message_id = message_row.id
        ) external_target on true
       where message_row.tenant_id = tenant_key
         and message_row.id = message_key
         and message_row.origin_kind = 'hulee_external'
         and not (
           (
             context_row.kind in ('none', 'forward_content_copy')
             and external_target.target_count = 0
           )
           or (
             context_row.kind in ('reply', 'forward_provider_native')
             and external_target.target_count = 1
           )
         )
         or message_row.tenant_id = tenant_key
         and message_row.id = message_key
         and message_row.origin_kind = 'hulee_external'
         and not (
           public.inbox_v2_tm_outbound_route_action_valid(
           message_row.tenant_id,
           message_row.origin_outbound_route_id,
           message_row.id,
           null,
           message_row.conversation_id,
           message_row.created_at,
           message_row.created_at,
           case context_row.kind
             when 'none' then 'core:message.send'
             when 'reply' then 'core:message.reply'
             when 'forward_content_copy' then
               'core:message.forward_content_copy'
             when 'forward_provider_native' then
               'core:message.forward_provider_native'
           end,
           case context_row.kind
             when 'none' then 'core:message.reply_external'
             when 'reply' then 'core:message.reply_external'
             when 'forward_content_copy' then
               'core:message.forward_external'
             when 'forward_provider_native' then
               'core:message.forward_external'
           end,
           case when context_row.kind in ('reply', 'forward_provider_native')
             then external_target.external_message_reference_id
             else null
           end,
           case when context_row.kind in ('reply', 'forward_provider_native')
             then external_target.source_occurrence_id
             else null
           end,
           null,
           null,
           null,
           case when context_row.kind = 'forward_provider_native'
             then context_row.native_adapter_contract_id
             else null
           end,
           case when context_row.kind = 'forward_provider_native'
             then context_row.native_adapter_contract_version
             else null
           end,
           case when context_row.kind = 'forward_provider_native'
             then context_row.native_adapter_declaration_revision
             else null
           end,
           case when context_row.kind = 'forward_provider_native'
             then context_row.native_adapter_surface_id
             else null
           end,
           case when context_row.kind = 'forward_provider_native'
             then context_row.native_adapter_loaded_by_trusted_service_id
             else null
           end,
           case when context_row.kind = 'forward_provider_native'
             then context_row.native_adapter_loaded_at
             else null
           end,
           case when context_row.kind = 'forward_provider_native'
             then context_row.native_capability_id
             else null
           end,
           case when context_row.kind = 'forward_provider_native'
             then context_row.native_capability_revision
             else null
           end,
           message_row.creation_attribution_id,
             false
           )
           and exists (
             select 1
               from public.inbox_v2_outbound_routes route_row
              where route_row.tenant_id = message_row.tenant_id
                and route_row.id = message_row.origin_outbound_route_id
                and route_row.created_at = message_row.created_at
           )
         )
    ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.message_origin_route_mismatch';
    end if;

    if exists (
      select 1
        from public.inbox_v2_messages message_row
       where message_row.tenant_id = tenant_key
         and message_row.id = message_key
         and (
           (
             message_row.origin_kind = 'hulee_external'
             and (
               1 <> (
                 select count(*)
                   from public.inbox_v2_outbound_dispatches dispatch_row
                  where dispatch_row.tenant_id = message_row.tenant_id
                    and dispatch_row.message_id = message_row.id
               )
               or not exists (
                 select 1
                   from public.inbox_v2_outbound_dispatches dispatch_row
                  where dispatch_row.tenant_id = message_row.tenant_id
                    and dispatch_row.message_id = message_row.id
                    and dispatch_row.conversation_id =
                      message_row.conversation_id
                    and dispatch_row.timeline_item_id =
                      message_row.timeline_item_id
                    and dispatch_row.route_id =
                      message_row.origin_outbound_route_id
                    and dispatch_row.created_at = message_row.created_at
               )
             )
           )
           or (
             message_row.origin_kind <> 'hulee_external'
             and exists (
               select 1
                 from public.inbox_v2_outbound_dispatches dispatch_row
                where dispatch_row.tenant_id = message_row.tenant_id
                  and dispatch_row.message_id = message_row.id
             )
           )
         )
    ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.message_dispatch_coherence';
    end if;

    if exists (
      select 1 from public.inbox_v2_messages message_row
       where message_row.tenant_id = tenant_key
         and message_row.id = message_key
         and message_row.origin_kind = 'hulee_external'
         and not exists (
           select 1
             from public.inbox_v2_outbound_route_consumptions consumption_row
            where consumption_row.tenant_id = message_row.tenant_id
              and consumption_row.consumer_kind = 'message_creation'
              and consumption_row.consumer_id = message_row.id
              and consumption_row.message_id = message_row.id
              and consumption_row.outbound_route_id =
                message_row.origin_outbound_route_id
         )
    ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.message_route_consumption_missing';
    end if;

    if exists (
      select 1 from public.inbox_v2_messages message_row
       where message_row.tenant_id = tenant_key
         and message_row.id = message_key
         and message_row.lifecycle = 'provider_delete_tombstone'
         and not exists (
           select 1
             from public.inbox_v2_message_provider_lifecycle_operations op_row
            where op_row.tenant_id = message_row.tenant_id
              and op_row.id = message_row.lifecycle_provider_operation_id
              and op_row.message_id = message_row.id
              and op_row.action = 'delete'
              and op_row.delete_local_effect = 'tombstone_local'
         )
    ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.message_lifecycle_operation_mismatch';
    end if;

    perform public.inbox_v2_tm_assert_reference_context(tenant_key, message_key);
  end if;

  if note_key is not null and exists (
    select 1 from public.inbox_v2_staff_notes
     where tenant_id = tenant_key and id = note_key
  ) and not exists (
    select 1
      from public.inbox_v2_staff_notes note_row
      join public.inbox_v2_timeline_items item_row
        on item_row.tenant_id = note_row.tenant_id
       and item_row.id = note_row.timeline_item_id
       and item_row.subject_kind = 'staff_note'
       and item_row.subject_id = note_row.id
       and item_row.visibility = 'staff_only'
       and item_row.revision = note_row.revision
      join public.inbox_v2_timeline_contents content_row
        on content_row.tenant_id = note_row.tenant_id
       and content_row.id = note_row.content_id
       and content_row.owner_kind = 'staff_note'
       and content_row.owner_id = note_row.id
       and content_row.revision = note_row.content_revision
       and content_row.state = note_row.content_state
      join public.inbox_v2_staff_note_revisions revision_row
        on revision_row.tenant_id = note_row.tenant_id
       and revision_row.staff_note_id = note_row.id
       and revision_row.timeline_item_id = note_row.timeline_item_id
       and revision_row.staff_note_revision = note_row.revision
       and revision_row.recorded_stream_position =
         note_row.last_changed_stream_position
       and revision_row.after_content_id = note_row.content_id
       and revision_row.after_content_revision = note_row.content_revision
       and revision_row.after_content_state = note_row.content_state
     where note_row.tenant_id = tenant_key and note_row.id = note_key
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.staff_note_head_coherence';
  end if;

  if note_key is not null and exists (
    select 1 from public.inbox_v2_staff_notes
     where tenant_id = tenant_key and id = note_key
  ) and not public.inbox_v2_tm_staff_note_history_valid(
    tenant_key,
    note_key
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.staff_note_revision_history_coherence';
  end if;

  if content_key is not null and exists (
    select 1 from public.inbox_v2_timeline_contents
     where tenant_id = tenant_key and id = content_key
  ) and tg_table_name = 'inbox_v2_timeline_contents'
    and tg_op = 'INSERT'
    and not exists (
      select 1
        from public.inbox_v2_timeline_contents content_row
       where content_row.tenant_id = tenant_key
         and content_row.id = content_key
         and (
           (content_row.owner_kind = 'message' and exists (
             select 1
               from public.inbox_v2_messages owner_row
               join public.inbox_v2_conversations conversation_row
                 on conversation_row.tenant_id = owner_row.tenant_id
                and conversation_row.id = owner_row.conversation_id
              where owner_row.tenant_id = content_row.tenant_id
                and owner_row.id = content_row.owner_id
                and conversation_row.purpose_id =
                  content_row.processing_purpose_id
           ))
           or (content_row.owner_kind = 'staff_note' and exists (
             select 1
               from public.inbox_v2_staff_notes owner_row
               join public.inbox_v2_conversations conversation_row
                 on conversation_row.tenant_id = owner_row.tenant_id
                and conversation_row.id = owner_row.conversation_id
              where owner_row.tenant_id = content_row.tenant_id
                and owner_row.id = content_row.owner_id
                and conversation_row.purpose_id =
                  content_row.processing_purpose_id
           ))
         )
    ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.timeline_content_creation_classification_coherence';
  end if;

  if content_key is not null and exists (
    select 1 from public.inbox_v2_timeline_contents
     where tenant_id = tenant_key and id = content_key
  ) and not exists (
    select 1
      from public.inbox_v2_timeline_contents content_row
      join public.inbox_v2_timeline_content_revisions revision_row
        on revision_row.tenant_id = content_row.tenant_id
       and revision_row.content_id = content_row.id
       and revision_row.revision = content_row.revision
       and revision_row.state = content_row.state
       and revision_row.recorded_stream_position =
         content_row.last_changed_stream_position
     where content_row.tenant_id = tenant_key
       and content_row.id = content_key
       and (
         (content_row.owner_kind = 'message' and exists (
           select 1 from public.inbox_v2_messages message_row
            where message_row.tenant_id = content_row.tenant_id
              and message_row.id = content_row.owner_id
              and message_row.content_id = content_row.id
         ))
         or (content_row.owner_kind = 'staff_note' and exists (
           select 1 from public.inbox_v2_staff_notes note_row
            where note_row.tenant_id = content_row.tenant_id
              and note_row.id = content_row.owner_id
              and note_row.content_id = content_row.id
         ))
       )
       and (
         (content_row.state = 'available' and (
           select count(*) between 1 and 64
             from public.inbox_v2_timeline_content_payloads payload_row
            where payload_row.tenant_id = content_row.tenant_id
              and payload_row.content_id = content_row.id
              and payload_row.content_revision = content_row.revision
         ) and (
           select min(payload_row.ordinal) = 0
              and max(payload_row.ordinal) = count(*) - 1
             from public.inbox_v2_timeline_content_payloads payload_row
            where payload_row.tenant_id = content_row.tenant_id
              and payload_row.content_id = content_row.id
              and payload_row.content_revision = content_row.revision
         ) and not exists (
           select 1
             from public.inbox_v2_timeline_content_payloads payload_row
             left join lateral (
               select count(*)::integer as value_count,
                      min(value_row.value_ordinal) as minimum_ordinal,
                      max(value_row.value_ordinal) as maximum_ordinal
                 from public.inbox_v2_timeline_content_contact_values value_row
                where value_row.tenant_id = payload_row.tenant_id
                  and value_row.content_id = payload_row.content_id
                  and value_row.content_revision = payload_row.content_revision
                  and value_row.block_ordinal = payload_row.ordinal
             ) contact_values on true
            where payload_row.tenant_id = content_row.tenant_id
              and payload_row.content_id = content_row.id
              and payload_row.content_revision = content_row.revision
              and (
                (payload_row.kind = 'contact' and not (
                  contact_values.value_count between 1 and 64
                  and contact_values.minimum_ordinal = 0
                  and contact_values.maximum_ordinal =
                    contact_values.value_count - 1
                ))
                or (payload_row.kind <> 'contact'
                  and contact_values.value_count <> 0)
              )
         ))
         or (content_row.state <> 'available' and not exists (
           select 1 from public.inbox_v2_timeline_content_payloads payload_row
            where payload_row.tenant_id = content_row.tenant_id
              and payload_row.content_id = content_row.id
         ))
       )
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.timeline_content_head_coherence';
  end if;

  if content_key is not null and exists (
    select 1 from public.inbox_v2_timeline_contents
     where tenant_id = tenant_key and id = content_key
  ) and not public.inbox_v2_tm_content_history_valid(
    tenant_key,
    content_key
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.timeline_content_revision_history_coherence';
  end if;

  if conversation_key is not null then
    select item_row.id, item_row.timeline_sequence, item_row.occurred_at
      into latest_item
      from public.inbox_v2_timeline_items item_row
     where item_row.tenant_id = tenant_key
       and item_row.conversation_id = conversation_key
       and item_row.activity_kind = 'eligible'
     order by item_row.timeline_sequence desc
     limit 1;

    select count(*) into actual_count
      from public.inbox_v2_conversation_heads head_row
     where head_row.tenant_id = tenant_key
       and head_row.conversation_id = conversation_key
       and head_row.latest_timeline_sequence = coalesce((
         select max(item_row.timeline_sequence)
           from public.inbox_v2_timeline_items item_row
          where item_row.tenant_id = tenant_key
            and item_row.conversation_id = conversation_key
       ), 0)
       and (
         (latest_item.id is null
           and head_row.latest_activity_item_id is null
           and head_row.latest_activity_timeline_sequence is null
           and head_row.latest_activity_at is null)
         or (latest_item.id is not null
           and head_row.latest_activity_item_id = latest_item.id
           and head_row.latest_activity_timeline_sequence =
             latest_item.timeline_sequence
           and head_row.latest_activity_at = latest_item.occurred_at)
       );

    if actual_count <> 1 then
      raise exception using errcode = '23514',
        message = 'inbox_v2.conversation_timeline_head_coherence';
    end if;
  end if;

  return null;
end;
$function$;
