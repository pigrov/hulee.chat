ALTER TABLE "inbox_v2_outbound_routes" DROP CONSTRAINT "inbox_v2_outbound_routes_selection_check";--> statement-breakpoint
ALTER TABLE "inbox_v2_outbound_routes" ADD CONSTRAINT "inbox_v2_outbound_routes_selection_check" CHECK (("inbox_v2_outbound_routes"."selection_intent_snapshot" #>> '{kind}' = "inbox_v2_outbound_routes"."selection_intent_kind"::text
        and (
          ("inbox_v2_outbound_routes"."selection_intent_kind" = 'automatic'
            and "inbox_v2_outbound_routes"."selection_intent_snapshot" = '{"kind":"automatic"}'::jsonb
            and "inbox_v2_outbound_routes"."selection_reason" in (
              'preferred_binding', 'sole_eligible_binding', 'policy_fallback'
            ))
          or ("inbox_v2_outbound_routes"."selection_intent_kind" = 'explicit_binding'
            and "inbox_v2_outbound_routes"."selection_reason" = 'explicit_binding'
            and "inbox_v2_outbound_routes"."selection_intent_snapshot" = jsonb_build_object(
              'kind', 'explicit_binding',
              'binding', jsonb_build_object(
                'tenantId', "inbox_v2_outbound_routes"."tenant_id",
                'kind', 'source_thread_binding',
                'id', "inbox_v2_outbound_routes"."source_thread_binding_id"
              )
            ))
          or ("inbox_v2_outbound_routes"."selection_intent_kind" = 'explicit_occurrence'
            and "inbox_v2_outbound_routes"."selection_reason" = 'explicit_occurrence'
            and coalesce((char_length("inbox_v2_outbound_routes"."selection_intent_snapshot" #>> '{occurrence,id}') <= 256
    and "inbox_v2_outbound_routes"."selection_intent_snapshot" #>> '{occurrence,id}' ~ '^source_occurrence:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false)
            and "inbox_v2_outbound_routes"."selection_intent_snapshot" = jsonb_build_object(
              'kind', 'explicit_occurrence',
              'occurrence', jsonb_build_object(
                'tenantId', "inbox_v2_outbound_routes"."tenant_id",
                'kind', 'source_occurrence',
                'id', "inbox_v2_outbound_routes"."selection_intent_snapshot" #>> '{occurrence,id}'
              )
            )
            and "inbox_v2_outbound_routes"."reference_context_snapshot" #>> '{kind}' =
              'external_message'
            and "inbox_v2_outbound_routes"."reference_context_snapshot" #>> '{sourceOccurrence,id}' =
              "inbox_v2_outbound_routes"."selection_intent_snapshot" #>> '{occurrence,id}'
            and "inbox_v2_outbound_routes"."reference_context_snapshot" #>> '{originBinding,id}' =
              "inbox_v2_outbound_routes"."source_thread_binding_id")
          or ("inbox_v2_outbound_routes"."selection_intent_kind" = 'explicit_reroute'
            and "inbox_v2_outbound_routes"."selection_reason" = 'explicit_reroute'
            and coalesce((char_length("inbox_v2_outbound_routes"."selection_intent_snapshot" #>> '{originalRoute,id}') <= 256
    and "inbox_v2_outbound_routes"."selection_intent_snapshot" #>> '{originalRoute,id}' ~ '^outbound_route:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false)
            and coalesce((char_length("inbox_v2_outbound_routes"."selection_intent_snapshot" #>> '{originalDispatch,id}') <= 256
    and "inbox_v2_outbound_routes"."selection_intent_snapshot" #>> '{originalDispatch,id}' ~ '^outbound_dispatch:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false)
            and coalesce(("inbox_v2_outbound_routes"."selection_intent_snapshot" ->> 'expectedOriginalDispatchRevision' ~ '^[1-9][0-9]{0,18}$'
    and (
      char_length("inbox_v2_outbound_routes"."selection_intent_snapshot" ->> 'expectedOriginalDispatchRevision') < 19
      or "inbox_v2_outbound_routes"."selection_intent_snapshot" ->> 'expectedOriginalDispatchRevision' <= '9223372036854775807'
    )), false)
            and coalesce((char_length("inbox_v2_outbound_routes"."selection_intent_snapshot" #>> '{reasonId}') <= 256 and (
    (
      "inbox_v2_outbound_routes"."selection_intent_snapshot" #>> '{reasonId}' ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_outbound_routes"."selection_intent_snapshot" #>> '{reasonId}', ':', 2)) <= 160
    ) or (
      "inbox_v2_outbound_routes"."selection_intent_snapshot" #>> '{reasonId}' ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_outbound_routes"."selection_intent_snapshot" #>> '{reasonId}', ':', 2)) <= 80
      and char_length(split_part("inbox_v2_outbound_routes"."selection_intent_snapshot" #>> '{reasonId}', ':', 3)) <= 160
      and split_part("inbox_v2_outbound_routes"."selection_intent_snapshot" #>> '{reasonId}', ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  )), false)
            and "inbox_v2_outbound_routes"."selection_intent_snapshot" = jsonb_build_object(
              'kind', 'explicit_reroute',
              'originalRoute', jsonb_build_object(
                'tenantId', "inbox_v2_outbound_routes"."tenant_id",
                'kind', 'outbound_route',
                'id', "inbox_v2_outbound_routes"."selection_intent_snapshot" #>> '{originalRoute,id}'
              ),
              'originalDispatch', jsonb_build_object(
                'tenantId', "inbox_v2_outbound_routes"."tenant_id",
                'kind', 'outbound_dispatch',
                'id', "inbox_v2_outbound_routes"."selection_intent_snapshot" #>> '{originalDispatch,id}'
              ),
              'expectedOriginalDispatchRevision',
                "inbox_v2_outbound_routes"."selection_intent_snapshot" ->> 'expectedOriginalDispatchRevision',
              'replacementBinding', jsonb_build_object(
                'tenantId', "inbox_v2_outbound_routes"."tenant_id",
                'kind', 'source_thread_binding',
                'id', "inbox_v2_outbound_routes"."source_thread_binding_id"
              ),
              'reasonId', "inbox_v2_outbound_routes"."selection_intent_snapshot" #>> '{reasonId}'
            ))
        )
        and ("inbox_v2_outbound_routes"."selection_reason" = 'policy_fallback') =
          ("inbox_v2_outbound_routes"."fallback_policy_ordinal" is not null)
        and ("inbox_v2_outbound_routes"."fallback_policy_ordinal" is null
          or "inbox_v2_outbound_routes"."fallback_policy_ordinal" between 0 and 31)
        and coalesce((char_length("inbox_v2_outbound_routes"."candidate_snapshot_token") between 8 and 256
    and "inbox_v2_outbound_routes"."candidate_snapshot_token" ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'), false)
        and isfinite("inbox_v2_outbound_routes"."candidate_snapshot_not_after")
        and isfinite("inbox_v2_outbound_routes"."selected_at")
        and "inbox_v2_outbound_routes"."selected_at" <= "inbox_v2_outbound_routes"."candidate_snapshot_not_after") is true);