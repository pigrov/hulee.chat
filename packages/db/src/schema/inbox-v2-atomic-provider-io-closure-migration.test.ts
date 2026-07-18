import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  INBOX_V2_AUTH_DOMAIN_PROVIDER_IO_CLOSURE_SQL,
  INBOX_V2_AUTHORIZATION_RELATIONS_INTEGRITY_SQL
} from "./inbox-v2/authorization-relations";

const migrationPath = new URL(
  "../../drizzle/0046_inbox_v2_atomic_provider_io_closure.sql",
  import.meta.url
);
const migration = readFileSync(migrationPath, "utf8").replaceAll("\r\n", "\n");
const historicalSchemaSql = restorePreMsg002AtomicProviderIoSql(
  INBOX_V2_AUTH_DOMAIN_PROVIDER_IO_CLOSURE_SQL.trim()
);

describe("Inbox V2 atomic provider-I/O closure migration", () => {
  it("installs the reviewed domain-coherence SQL verbatim", () => {
    expect(migration).toBe(`${historicalSchemaSql}\n`);
    expect(migration).toContain(
      "-- INB2-SRC-007_PROVIDER_IO_ATOMIC_CLOSURE_V1"
    );
    expect(
      migration.match(
        /create or replace function public\.inbox_v2_auth_domain_mutation_coherence\(\)/giu
      )
    ).toHaveLength(1);
    expect(migration).not.toContain(
      "create or replace function public.inbox_v2_auth_mutation_coherence()"
    );
    expect(
      "inbox_v2_atomic_dispatch_materializations_immutable_trigger".length
    ).toBeLessThanOrEqual(63);
    expect(migration).not.toContain(
      "inbox_v2_atomic_outbound_dispatch_materializations_immutable_trigger"
    );
    const atomicIdentifiers = [
      ...new Set(migration.match(/inbox_v2_atomic_[a-z0-9_]+/giu) ?? [])
    ];
    expect(atomicIdentifiers.length).toBeGreaterThan(0);
    for (const identifier of atomicIdentifiers) {
      expect(identifier.length, identifier).toBeLessThanOrEqual(63);
    }
  });

  it("keeps authorization-relation commits unable to enqueue provider I/O", () => {
    const relationFunction =
      INBOX_V2_AUTHORIZATION_RELATIONS_INTEGRITY_SQL.slice(
        INBOX_V2_AUTHORIZATION_RELATIONS_INTEGRITY_SQL.indexOf(
          "create or replace function public.inbox_v2_auth_mutation_coherence()"
        ),
        INBOX_V2_AUTHORIZATION_RELATIONS_INTEGRITY_SQL.indexOf(
          "create or replace function public.inbox_v2_auth_mutation_child_coherence()"
        )
      );

    expect(relationFunction).toContain(
      "or intent_row.effect_class = 'provider_io'"
    );
    expect(migration).not.toContain(
      "create or replace function public.inbox_v2_auth_mutation_coherence()"
    );
  });

  it("accepts domain provider work only with the contract-equivalent dispatch closure", () => {
    for (const fragment of [
      "create table public.inbox_v2_atomic_outbound_dispatch_materializations",
      "inbox_v2_atomic_outbound_dispatch_materializations_stream_fk",
      "deferrable initially deferred",
      "inbox_v2_atomic_outbound_dispatch_materializations_dispatch_fk",
      "inbox_v2_atomic_dispatch_materializations_immutable_trigger",
      "intent_row.type_id = 'core:provider.dispatch'",
      "intent_row.effect_class <> 'provider_io'",
      "intent_row.effect_class = 'provider_io'",
      "intent_row.payload_reference->>'schemaId' <>",
      "'core:inbox-v2.outbound-dispatch'",
      "intent_row.payload_reference->>'schemaVersion' <> 'v1'",
      "jsonb_array_length(intent_row.change_ids) <> 1",
      "referenced_change.audience = 'staff_only'",
      "referenced_change.entity_type_id = 'core:staff-note'",
      "dispatch_change.entity_type_id =",
      "dispatch_change.entity_id =",
      "intent_row.payload_reference->>'recordId'",
      "dispatch_change.state_kind = 'upsert'",
      "dispatch_change.state_schema_id =",
      "dispatch_change.state_schema_version = 'v1'",
      "dispatch_change.payload_reference =",
      "intent_row.payload_reference",
      "dispatch_change.state_hash =",
      "dispatch_change.payload_reference->>'digest'",
      "from public.inbox_v2_outbound_dispatches dispatch_row",
      "dispatch_row.state = 'queued'",
      "dispatch_row.attempt_count = 0",
      "dispatch_row.active_attempt_id is null",
      "dispatch_row.last_attempt_id is null",
      "dispatch_row.retry_authorization_decision_id is null",
      "dispatch_row.revision = 1",
      "dispatch_row.created_at = new.committed_at",
      "dispatch_row.updated_at = new.committed_at",
      "from public.inbox_v2_outbound_dispatch_attempts",
      "left join public.inbox_v2_outbound_dispatches dispatch_row",
      "dispatch_change.resulting_revision = 1",
      "dispatch_change.resulting_revision <> 1",
      "materialization_row.resulting_revision is distinct from",
      "materialization_row.created_at <> new.committed_at",
      "dispatch_row.id is null",
      "from public.inbox_v2_tenant_stream_changes sibling_change",
      "sibling_change.entity_id = dispatch_change.entity_id",
      "provider_intent.payload_reference =",
      "dispatch_change.payload_reference",
      "from public.inbox_v2_outbox_intents provider_intent",
      "provider_intent.effect_class = 'provider_io'",
      "provider_intent.type_id = 'core:provider.dispatch'",
      "provider_intent.change_ids ? dispatch_change.id",
      "projection_intent.tenant_id = dispatch_change.tenant_id",
      "message_event.type_id = 'core:message.changed'",
      "message_event.subjects @> jsonb_build_array(",
      "'entityTypeId', 'core:message'",
      ") <> 1",
      "not (event_row.change_ids @> intent_row.change_ids)"
    ]) {
      expect(migration).toContain(fragment);
    }
    expect(migration).not.toContain(
      "and sibling_change.resulting_revision = 1"
    );
  });

  it("closes Message creation from the canonical row through its exact stream graph", () => {
    for (const fragment of [
      "message_change.entity_type_id = 'core:message'",
      "message_change.payload_reference is distinct from",
      "v_command.result_reference",
      "message_change.state_hash is distinct from",
      "message_change.payload_reference->>'digest'",
      "v_audit.evidence_reference is distinct from",
      "message_change.domain_commit_reference",
      "left join public.inbox_v2_messages message_row",
      "left join public.inbox_v2_timeline_items timeline_row",
      "left join public.inbox_v2_timeline_contents content_row",
      "left join public.inbox_v2_timeline_content_revisions",
      "left join public.inbox_v2_message_revisions initial_revision_row",
      "timeline_row.last_changed_stream_position <>",
      "content_row.last_changed_stream_position <>",
      "content_revision_row.recorded_stream_position <>",
      "initial_revision_row.recorded_stream_position <>",
      "'kind', 'conversation'",
      "message_event.type_id = 'core:message.changed'",
      "related_event.change_ids ? message_change.id",
      "projection_event.type_id = 'core:message.changed'",
      "select count(*)",
      "v_command.command_type_id in ('core:message.send', 'core:message.receive')",
      "v_message_change_count <> 1",
      "v_message_row_count <> 1",
      "create or replace function public.inbox_v2_atomic_message_creation_coherence()",
      "create constraint trigger inbox_v2_atomic_message_creation_constraint",
      "message = 'inbox_v2.atomic_message_creation_closure_missing'"
    ]) {
      expect(migration).toContain(fragment);
    }
    expect(migration).not.toContain("inbox_v2_atomic_message_materializations");
  });

  it("binds source resolution and outbound route/dispatch creation in both directions", () => {
    for (const fragment of [
      "create table public.inbox_v2_atomic_source_resolution_materializations",
      "inbox_v2_atomic_src_resolution_transition_fk",
      "inbox_v2_atomic_src_resolution_mutation_fk",
      "occurrence_change.entity_type_id = 'core:source-occurrence'",
      "occurrence_change.audience <> 'policy_filtered'",
      "occurrence_change.state_hash is distinct from",
      "occurrence_change.payload_reference->>'digest'",
      "occurrence_event.type_id = 'core:source-occurrence.changed'",
      "related_event.change_ids ? occurrence_change.id",
      "projection_event.type_id = 'core:source-occurrence.changed'",
      "tg_table_name =",
      "'inbox_v2_atomic_source_resolution_materializations'",
      "occurrence_change.domain_commit_reference->>'recordId' =",
      "transition_row.id",
      "message = 'inbox_v2.atomic_source_resolution_closure_missing'",
      "v_source_change_count <> 1",
      "v_source_materialization_count <> 1",
      "create constraint trigger inbox_v2_atomic_src_resolution_constraint",
      "create constraint trigger inbox_v2_atomic_src_transition_constraint",
      "create or replace function public.inbox_v2_atomic_outbound_creation_coherence()",
      "create constraint trigger inbox_v2_atomic_outbound_route_constraint",
      "create constraint trigger inbox_v2_atomic_outbound_dispatch_constraint",
      "create constraint trigger inbox_v2_atomic_outbound_ledger_constraint",
      "message = 'inbox_v2.atomic_outbound_creation_closure_missing'"
    ]) {
      expect(migration).toContain(fragment);
    }
    expect(migration).not.toContain(
      "if (v_changed->>'revision')::bigint <> 1\n" +
        "       or (v_changed->>'attempt_count')::integer <> 0 then\n" +
        "      return null;"
    );
  });

  it("requires explicit reroute to cancel the untouched original dispatch before replacement provider I/O", () => {
    for (const fragment of [
      "dispatch_change.resulting_revision = 2",
      "dispatch_row.state = 'cancelled'",
      "dispatch_change.state_reason_id is null",
      "core:inbox-v2.outbound-dispatch-reroute-commit",
      "'{originalDispatch,id}'",
      "original_dispatch.state = 'cancelled'",
      "original_dispatch.revision = 2",
      "original_event.type_id =",
      "'core:outbound-dispatch.changed'",
      "projection_intent.effect_class = 'projection'",
      "original_work.state in ('pending', 'leased')",
      "forbidden_provider_intent.effect_class = 'provider_io'",
      "reroute_audit.target_type_id =",
      "reroute_audit.evidence_reference =",
      "sibling_dispatch_change.entity_type_id ="
    ]) {
      expect(INBOX_V2_AUTH_DOMAIN_PROVIDER_IO_CLOSURE_SQL).toContain(fragment);
    }
  });
});

function restorePreMsg002AtomicProviderIoSql(current: string): string {
  const withoutRerouteCancellation =
    restoreMsg002RerouteCancellationSql(current);
  const replacements: readonly (readonly [string, string])[] = [
    [
      `  if v_command.command_type_id in (
    'core:message.send',
    'core:message.receive',
    'core:source.dispatch.reroute'
  )
  then`,
      `  if v_command.command_type_id in ('core:message.send', 'core:message.receive')
  then`
    ],
    [
      `         v_command.command_type_id in (
           'core:message.send',
           'core:source.dispatch.reroute'
         )
         and (
           v_source_change_count <> 0
           or v_source_materialization_count <> 0
         )`,
      `         v_command.command_type_id = 'core:message.send'
         and (
           v_source_change_count <> 0
           or v_source_materialization_count <> 0
         )`
    ],
    [
      `       or (
         v_command.command_type_id <> 'core:source.dispatch.reroute'
         and v_audit.evidence_reference is distinct from
            message_change.domain_commit_reference
       )`,
      `       or v_audit.evidence_reference is distinct from
          message_change.domain_commit_reference`
    ],
    [
      `         message_row.origin_kind = 'hulee_external'
         and (
           (
             command_row.command_type_id = 'core:message.send'
             and exists (
               select 1
                 from public.inbox_v2_outbound_routes route_row
                where route_row.tenant_id = message_row.tenant_id
                  and route_row.id = message_row.origin_outbound_route_id
                  and route_row.selection_intent_kind <> 'explicit_reroute'
             )
           )
           or (
             command_row.command_type_id = 'core:source.dispatch.reroute'
             and exists (
               select 1
                 from public.inbox_v2_outbound_routes route_row
                where route_row.tenant_id = message_row.tenant_id
                  and route_row.id = message_row.origin_outbound_route_id
                  and route_row.selection_intent_kind = 'explicit_reroute'
             )
           )
         )
         and (`,
      `         message_row.origin_kind = 'hulee_external'
         and command_row.command_type_id = 'core:message.send'
         and (`
    ],
    [
      `     and command_row.state = 'completed'
     and (
       (
         command_row.command_type_id = 'core:message.send'
         and route_row.selection_intent_kind <> 'explicit_reroute'
       )
       or (
         command_row.command_type_id = 'core:source.dispatch.reroute'
         and route_row.selection_intent_kind = 'explicit_reroute'
         and (
           select count(*)
             from jsonb_array_elements(
               command_row.authorization_decision_refs
             ) decision_ref
             join public.inbox_v2_outbound_routes original_route
               on original_route.tenant_id = route_row.tenant_id
              and original_route.id =
                route_row.selection_intent_snapshot #>>
                  '{originalRoute,id}'
            where decision_ref->>'id' =
                    command_row.authorization_decision_id
              and decision_ref->>'authorizationEpoch' =
                    command_row.authorization_epoch
              and decision_ref->>'permissionId' =
                    'core:source.dispatch.reroute'
              and decision_ref->>'resourceScopeId' =
                    'core:source-account'
              and decision_ref->>'outcome' = 'allowed'
              and decision_ref #>> '{resource,tenantId}' =
                    route_row.tenant_id
              and decision_ref #>> '{resource,entityTypeId}' =
                    'core:source-account'
              and decision_ref #>> '{resource,entityId}' =
                    original_route.source_account_id
         ) = 1
       )
     )
    join public.inbox_v2_messages message_row`,
      `     and command_row.state = 'completed'
     and command_row.command_type_id = 'core:message.send'
    join public.inbox_v2_messages message_row`
    ]
  ];

  return replacements.reduce((value, [successor, predecessor], index) => {
    const occurrences = value.split(successor).length - 1;
    if (occurrences !== 1) {
      throw new Error(
        `MSG-002 historical 0046 restoration ${index + 1} matched ${occurrences} times.`
      );
    }
    return value.replace(successor, predecessor);
  }, withoutRerouteCancellation);
}

function restoreMsg002RerouteCancellationSql(current: string): string {
  const dispatchStart =
    `     and dispatch_change.entity_type_id = 'core:outbound-dispatch'\n` +
    `     and not (\n`;
  const dispatchEnd =
    `     and (\n` + `       dispatch_change.resulting_revision <> 1`;
  let restored = replaceExactBoundedSpan(
    current,
    dispatchStart,
    dispatchEnd,
    `     and dispatch_change.entity_type_id = 'core:outbound-dispatch'\n` +
      dispatchEnd
  );

  const outboundStart =
    `         ) = 1\n` +
    `         and route_row.selection_intent_snapshot #>>\n` +
    `               '{originalRoute,tenantId}' = route_row.tenant_id`;
  const outboundEnd =
    `         ) = 2\n` +
    `       )\n` +
    `     )\n` +
    `    join public.inbox_v2_messages message_row`;
  restored = replaceExactBoundedSpan(
    restored,
    outboundStart,
    outboundEnd,
    `         ) = 1\n` +
      `       )\n` +
      `     )\n` +
      `    join public.inbox_v2_messages message_row`
  );
  return restored;
}

function replaceExactBoundedSpan(
  input: string,
  start: string,
  end: string,
  replacement: string
): string {
  const startOccurrences = input.split(start).length - 1;
  if (startOccurrences !== 1) {
    throw new Error(
      `MSG-002 bounded restoration start matched ${startOccurrences} times.`
    );
  }
  const startIndex = input.indexOf(start);
  const endIndex = input.indexOf(end, startIndex + start.length);
  if (endIndex < 0 || input.indexOf(end, endIndex + end.length) >= 0) {
    throw new Error("MSG-002 bounded restoration end is missing or ambiguous.");
  }
  return `${input.slice(0, startIndex)}${replacement}${input.slice(endIndex + end.length)}`;
}
