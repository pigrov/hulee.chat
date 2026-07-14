import { sql, type SQL } from "drizzle-orm";
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

import { clients, employees, tenants } from "../tables";

export const inboxV2ClientMergeNodeStateKind = pgEnum(
  "inbox_v2_client_merge_node_state_kind",
  ["canonical_root", "redirected"]
);

export const inboxV2ClientMergeActorKind = pgEnum(
  "inbox_v2_client_merge_actor_kind",
  ["employee", "trusted_service", "migration_service"]
);

/**
 * One immutable row-wise merge fact. The row stores the complete exact before
 * and after state used by ClientMergeCommit; no JSON payload is authoritative.
 */
export const inboxV2ClientMergeRedirects = pgTable(
  "inbox_v2_client_merge_redirects",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    sourceRootClientId: text("source_root_client_id").notNull(),
    targetRootClientId: text("target_root_client_id").notNull(),

    expectedGraphRevision: bigint("expected_graph_revision", {
      mode: "bigint"
    }),
    currentGraphRevision: bigint("current_graph_revision", { mode: "bigint" }),
    resultingGraphRevision: bigint("resulting_graph_revision", {
      mode: "bigint"
    }).notNull(),
    headBeforeUpdatedAt: timestamp("head_before_updated_at", {
      withTimezone: true,
      precision: 3
    }),
    headAfterUpdatedAt: timestamp("head_after_updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),

    resolverTrustedServiceId: text("resolver_trusted_service_id").notNull(),
    resolvedAt: timestamp("resolved_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    decisionActorKind: inboxV2ClientMergeActorKind(
      "decision_actor_kind"
    ).notNull(),
    decisionActorEmployeeId: text("decision_actor_employee_id"),
    decisionActorTrustedServiceId: text("decision_actor_trusted_service_id"),
    decisionPolicyId: text("decision_policy_id").notNull(),
    decisionPolicyVersion: text("decision_policy_version").notNull(),
    decisionReasonCodeId: text("decision_reason_code_id").notNull(),

    sourceBeforeState: inboxV2ClientMergeNodeStateKind(
      "source_before_state"
    ).notNull(),
    sourceBeforeNextClientId: text("source_before_next_client_id"),
    sourceBeforeRedirectId: text("source_before_redirect_id"),
    sourceBeforeMaximumInboundDepth: integer(
      "source_before_maximum_inbound_depth"
    ).notNull(),
    sourceBeforeRevision: bigint("source_before_revision", {
      mode: "bigint"
    }).notNull(),
    sourceBeforeLastGraphRevision: bigint("source_before_last_graph_revision", {
      mode: "bigint"
    }),
    sourceBeforeUpdatedAt: timestamp("source_before_updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),

    targetBeforeState: inboxV2ClientMergeNodeStateKind(
      "target_before_state"
    ).notNull(),
    targetBeforeNextClientId: text("target_before_next_client_id"),
    targetBeforeRedirectId: text("target_before_redirect_id"),
    targetBeforeMaximumInboundDepth: integer(
      "target_before_maximum_inbound_depth"
    ).notNull(),
    targetBeforeRevision: bigint("target_before_revision", {
      mode: "bigint"
    }).notNull(),
    targetBeforeLastGraphRevision: bigint("target_before_last_graph_revision", {
      mode: "bigint"
    }),
    targetBeforeUpdatedAt: timestamp("target_before_updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),

    sourceAfterState:
      inboxV2ClientMergeNodeStateKind("source_after_state").notNull(),
    sourceAfterNextClientId: text("source_after_next_client_id").notNull(),
    sourceAfterRedirectId: text("source_after_redirect_id").notNull(),
    sourceAfterMaximumInboundDepth: integer(
      "source_after_maximum_inbound_depth"
    ).notNull(),
    sourceAfterRevision: bigint("source_after_revision", {
      mode: "bigint"
    }).notNull(),
    sourceAfterLastGraphRevision: bigint("source_after_last_graph_revision", {
      mode: "bigint"
    }).notNull(),
    sourceAfterUpdatedAt: timestamp("source_after_updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),

    targetAfterState:
      inboxV2ClientMergeNodeStateKind("target_after_state").notNull(),
    targetAfterNextClientId: text("target_after_next_client_id"),
    targetAfterRedirectId: text("target_after_redirect_id"),
    targetAfterMaximumInboundDepth: integer(
      "target_after_maximum_inbound_depth"
    ).notNull(),
    targetAfterRevision: bigint("target_after_revision", {
      mode: "bigint"
    }).notNull(),
    targetAfterLastGraphRevision: bigint("target_after_last_graph_revision", {
      mode: "bigint"
    }).notNull(),
    targetAfterUpdatedAt: timestamp("target_after_updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),

    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    revision: bigint("revision", { mode: "bigint" })
      .notNull()
      .default(sql`1`)
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_client_merge_redirects_pk",
      columns: [table.tenantId, table.id]
    }),
    unique("inbox_v2_client_merge_redirects_graph_revision_unique").on(
      table.tenantId,
      table.resultingGraphRevision
    ),
    unique("inbox_v2_client_merge_redirects_source_root_unique").on(
      table.tenantId,
      table.sourceRootClientId
    ),
    foreignKey({
      name: "inbox_v2_client_merge_redirects_source_client_fk",
      columns: [table.tenantId, table.sourceRootClientId],
      foreignColumns: [clients.tenantId, clients.id]
    }),
    foreignKey({
      name: "inbox_v2_client_merge_redirects_target_client_fk",
      columns: [table.tenantId, table.targetRootClientId],
      foreignColumns: [clients.tenantId, clients.id]
    }),
    foreignKey({
      name: "inbox_v2_client_merge_redirects_actor_employee_fk",
      columns: [table.tenantId, table.decisionActorEmployeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }),
    check(
      "inbox_v2_client_merge_redirects_id_format_check",
      sql`char_length(${table.id}) <= 256
        and ${table.id} ~ '^client_merge_redirect:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'`
    ),
    check(
      "inbox_v2_client_merge_redirects_distinct_roots_check",
      sql`${table.sourceRootClientId} <> ${table.targetRootClientId}`
    ),
    check(
      "inbox_v2_client_merge_redirects_actor_xor_check",
      sql`(
          ${table.decisionActorKind} = 'employee'
          and ${table.decisionActorEmployeeId} is not null
          and ${table.decisionActorTrustedServiceId} is null
        ) or (
          ${table.decisionActorKind} in ('trusted_service', 'migration_service')
          and ${table.decisionActorEmployeeId} is null
          and ${table.decisionActorTrustedServiceId} is not null
          and ${table.decisionActorTrustedServiceId} = ${table.resolverTrustedServiceId}
        )`
    ),
    check(
      "inbox_v2_client_merge_redirects_catalog_ids_check",
      sql`${catalogIdCheck(table.resolverTrustedServiceId)}
        and ${catalogIdCheck(table.decisionPolicyId)}
        and ${catalogIdCheck(table.decisionReasonCodeId)}
        and (
          ${table.decisionActorTrustedServiceId} is null
          or ${catalogIdCheck(table.decisionActorTrustedServiceId)}
        )
        and ${table.decisionPolicyVersion} ~ '^v[1-9][0-9]*$'`
    ),
    check(
      "inbox_v2_client_merge_redirects_graph_cas_check",
      sql`${table.expectedGraphRevision} is not distinct from ${table.currentGraphRevision}
        and (
          (${table.currentGraphRevision} is null
            and ${table.resultingGraphRevision} = 1
            and ${table.headBeforeUpdatedAt} is null)
          or
          (${table.currentGraphRevision} is not null
            and ${table.currentGraphRevision} >= 1
            and ${table.currentGraphRevision} < 9223372036854775807
            and ${table.resultingGraphRevision} = ${table.currentGraphRevision} + 1
            and ${table.headBeforeUpdatedAt} is not null)
        )`
    ),
    check(
      "inbox_v2_client_merge_redirects_before_shape_check",
      sql`${table.sourceBeforeState} = 'canonical_root'
        and ${table.sourceBeforeNextClientId} is null
        and ${table.sourceBeforeRedirectId} is null
        and ${table.targetBeforeState} = 'canonical_root'
        and ${table.targetBeforeNextClientId} is null
        and ${table.targetBeforeRedirectId} is null
        and ${canonicalBeforeNodeCheck(
          table.sourceBeforeMaximumInboundDepth,
          table.sourceBeforeRevision,
          table.sourceBeforeLastGraphRevision,
          table.currentGraphRevision
        )}
        and ${canonicalBeforeNodeCheck(
          table.targetBeforeMaximumInboundDepth,
          table.targetBeforeRevision,
          table.targetBeforeLastGraphRevision,
          table.currentGraphRevision
        )}`
    ),
    check(
      "inbox_v2_client_merge_redirects_after_shape_check",
      sql`${table.sourceAfterState} = 'redirected'
        and ${table.sourceAfterNextClientId} = ${table.targetRootClientId}
        and ${table.sourceAfterRedirectId} = ${table.id}
        and ${table.sourceAfterMaximumInboundDepth} = ${table.sourceBeforeMaximumInboundDepth}
        and ${table.sourceBeforeRevision} < 9223372036854775807
        and ${table.sourceAfterRevision} = ${table.sourceBeforeRevision} + 1
        and ${table.sourceAfterLastGraphRevision} = ${table.resultingGraphRevision}
        and ${table.sourceAfterUpdatedAt} = ${table.createdAt}
        and ${table.targetAfterState} = 'canonical_root'
        and ${table.targetAfterNextClientId} is null
        and ${table.targetAfterRedirectId} is null
        and ${table.targetBeforeRevision} < 9223372036854775807
        and ${table.targetAfterRevision} = ${table.targetBeforeRevision} + 1
        and ${table.targetAfterLastGraphRevision} = ${table.resultingGraphRevision}
        and ${table.targetAfterUpdatedAt} = ${table.createdAt}
        and ${table.headAfterUpdatedAt} = ${table.createdAt}`
    ),
    check(
      "inbox_v2_client_merge_redirects_depth_check",
      sql`${table.sourceBeforeMaximumInboundDepth} between 0 and 63
        and ${table.targetBeforeMaximumInboundDepth} between 0 and 64
        and ${table.targetAfterMaximumInboundDepth} = greatest(
          ${table.targetBeforeMaximumInboundDepth},
          ${table.sourceBeforeMaximumInboundDepth} + 1
        )
        and ${table.targetAfterMaximumInboundDepth} between 1 and 64`
    ),
    check(
      "inbox_v2_client_merge_redirects_timestamps_check",
      sql`isfinite(${table.resolvedAt})
        and isfinite(${table.sourceBeforeUpdatedAt})
        and isfinite(${table.targetBeforeUpdatedAt})
        and isfinite(${table.sourceAfterUpdatedAt})
        and isfinite(${table.targetAfterUpdatedAt})
        and isfinite(${table.headAfterUpdatedAt})
        and isfinite(${table.createdAt})
        and (${table.headBeforeUpdatedAt} is null or isfinite(${table.headBeforeUpdatedAt}))
        and (${table.headBeforeUpdatedAt} is null or ${table.headBeforeUpdatedAt} <= ${table.resolvedAt})
        and ${table.sourceBeforeUpdatedAt} <= ${table.resolvedAt}
        and ${table.targetBeforeUpdatedAt} <= ${table.resolvedAt}
        and ${table.resolvedAt} <= ${table.createdAt}`
    ),
    check(
      "inbox_v2_client_merge_redirects_revision_check",
      sql`${table.revision} = 1`
    ),
    index("inbox_v2_client_merge_redirects_tenant_history_idx").on(
      table.tenantId,
      table.resultingGraphRevision.desc(),
      table.id
    ),
    index("inbox_v2_client_merge_redirects_tenant_target_idx").on(
      table.tenantId,
      table.targetRootClientId,
      table.resultingGraphRevision.desc(),
      table.id
    )
  ]
);

/** Mandatory authoritative current projection: exactly one row per Client. */
export const inboxV2ClientMergeNodeStates = pgTable(
  "inbox_v2_client_merge_node_states",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull(),
    state: inboxV2ClientMergeNodeStateKind("state").notNull(),
    nextClientId: text("next_client_id"),
    redirectId: text("redirect_id"),
    maximumInboundDepth: integer("maximum_inbound_depth").notNull().default(0),
    revision: bigint("revision", { mode: "bigint" })
      .notNull()
      .default(sql`1`),
    lastGraphRevision: bigint("last_graph_revision", { mode: "bigint" }),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_client_merge_node_states_pk",
      columns: [table.tenantId, table.clientId]
    }),
    foreignKey({
      name: "inbox_v2_client_merge_node_states_client_fk",
      columns: [table.tenantId, table.clientId],
      foreignColumns: [clients.tenantId, clients.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_client_merge_node_states_next_client_fk",
      columns: [table.tenantId, table.nextClientId],
      foreignColumns: [clients.tenantId, clients.id]
    }),
    foreignKey({
      name: "inbox_v2_client_merge_node_states_redirect_fk",
      columns: [table.tenantId, table.redirectId],
      foreignColumns: [
        inboxV2ClientMergeRedirects.tenantId,
        inboxV2ClientMergeRedirects.id
      ]
    }),
    check(
      "inbox_v2_client_merge_node_states_shape_check",
      sql`(
          ${table.state} = 'canonical_root'
          and ${table.nextClientId} is null
          and ${table.redirectId} is null
        ) or (
          ${table.state} = 'redirected'
          and ${table.nextClientId} is not null
          and ${table.nextClientId} <> ${table.clientId}
          and ${table.redirectId} is not null
          and ${table.maximumInboundDepth} < 64
        )`
    ),
    check(
      "inbox_v2_client_merge_node_states_initial_or_mutated_check",
      sql`(
          ${table.lastGraphRevision} is null
          and ${table.state} = 'canonical_root'
          and ${table.maximumInboundDepth} = 0
          and ${table.revision} = 1
        ) or (
          ${table.lastGraphRevision} is not null
          and ${table.lastGraphRevision} >= 1
          and ${table.revision} >= 2
          and (
            ${table.state} = 'redirected'
            or ${table.maximumInboundDepth} between 1 and 64
          )
        )`
    ),
    check(
      "inbox_v2_client_merge_node_states_depth_revision_check",
      sql`${table.maximumInboundDepth} between 0 and 64
        and ${table.revision} >= 1
        and isfinite(${table.updatedAt})`
    ),
    index("inbox_v2_client_merge_node_states_tenant_state_idx").on(
      table.tenantId,
      table.state,
      table.clientId
    ),
    index("inbox_v2_client_merge_node_states_tenant_next_idx").on(
      table.tenantId,
      table.nextClientId,
      table.clientId
    )
  ]
);

/**
 * One lockable row per tenant. Nullable revision/time is the storage form of
 * the contract's `graphHead: null` before the first committed redirect.
 */
export const inboxV2ClientMergeGraphHeads = pgTable(
  "inbox_v2_client_merge_graph_heads",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    revision: bigint("revision", { mode: "bigint" }),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      precision: 3
    }),
    latestRedirectId: text("latest_redirect_id")
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_client_merge_graph_heads_pk",
      columns: [table.tenantId]
    }),
    foreignKey({
      name: "inbox_v2_client_merge_graph_heads_latest_redirect_fk",
      columns: [table.tenantId, table.latestRedirectId],
      foreignColumns: [
        inboxV2ClientMergeRedirects.tenantId,
        inboxV2ClientMergeRedirects.id
      ]
    }),
    check(
      "inbox_v2_client_merge_graph_heads_nullable_state_check",
      sql`(
          ${table.revision} is null
          and ${table.updatedAt} is null
          and ${table.latestRedirectId} is null
        ) or (
          ${table.revision} >= 1
          and ${table.updatedAt} is not null
          and isfinite(${table.updatedAt})
          and ${table.latestRedirectId} is not null
        )`
    ),
    index("inbox_v2_client_merge_graph_heads_tenant_revision_idx").on(
      table.tenantId,
      table.revision
    )
  ]
);

function catalogIdCheck(column: unknown): SQL {
  return sql`char_length(${column as never}) <= 256 and (
    (
      ${column as never} ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part(${column as never}, ':', 2)) <= 160
    ) or (
      ${column as never} ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part(${column as never}, ':', 2)) <= 80
      and char_length(split_part(${column as never}, ':', 3)) <= 160
      and split_part(${column as never}, ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  )`;
}

function canonicalBeforeNodeCheck(
  depth: unknown,
  revision: unknown,
  lastGraphRevision: unknown,
  currentGraphRevision: unknown
): SQL {
  return sql`${depth as never} between 0 and 64
    and (
      (${lastGraphRevision as never} is null
        and ${revision as never} = 1
        and ${depth as never} = 0)
      or
      (${lastGraphRevision as never} is not null
        and ${lastGraphRevision as never} >= 1
        and ${revision as never} >= 2
        and ${depth as never} between 1 and 64
        and ${currentGraphRevision as never} is not null
        and ${lastGraphRevision as never} <= ${currentGraphRevision as never})
    )`;
}

/**
 * Migration backfill plus PostgreSQL-side append-only and exact projection
 * induction. The finalizer appends this block only after all generated DDL/FKs.
 */
export const INBOX_V2_CLIENT_MERGE_INTEGRITY_SQL = String.raw`
insert into public.inbox_v2_client_merge_graph_heads (
  tenant_id, revision, updated_at, latest_redirect_id
)
select tenant_row.id, null, null, null
from public.tenants tenant_row
on conflict (tenant_id) do nothing;

insert into public.inbox_v2_client_merge_node_states (
  tenant_id, client_id, state, next_client_id, redirect_id,
  maximum_inbound_depth, revision, last_graph_revision, updated_at
)
select
  client_row.tenant_id, client_row.id, 'canonical_root', null, null,
  0, 1, null, client_row.created_at
from public.clients client_row
on conflict (tenant_id, client_id) do nothing;

create or replace function public.inbox_v2_client_merge_reject_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'DELETE'
     and tg_table_name = 'inbox_v2_client_merge_redirects'
     and not exists (
       select 1
       from public.tenants tenant_row
       where tenant_row.id = old.tenant_id
     ) then
    return old;
  end if;

  raise exception using
    errcode = '23514',
    message = format('inbox_v2.client_merge_immutable:%s:%s', tg_table_name, tg_op);
end;
$function$;

create or replace function public.inbox_v2_client_merge_bootstrap_tenant_head()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  insert into public.inbox_v2_client_merge_graph_heads (
    tenant_id, revision, updated_at, latest_redirect_id
  ) values (new.id, null, null, null)
  on conflict (tenant_id) do nothing;
  return new;
end;
$function$;

create or replace function public.inbox_v2_client_merge_bootstrap_client_node()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  insert into public.inbox_v2_client_merge_node_states (
    tenant_id, client_id, state, next_client_id, redirect_id,
    maximum_inbound_depth, revision, last_graph_revision, updated_at
  ) values (
    new.tenant_id, new.id, 'canonical_root', null, null,
    0, 1, null, new.created_at
  )
  on conflict (tenant_id, client_id) do nothing;
  return new;
end;
$function$;

create or replace function public.inbox_v2_assert_client_merge_head_exists(
  checked_tenant_id text
)
returns void
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  tenant_count integer;
  head_count integer;
begin
  select count(*)::integer into tenant_count
  from public.tenants tenant_row
  where tenant_row.id = checked_tenant_id;

  select count(*)::integer into head_count
  from public.inbox_v2_client_merge_graph_heads head_row
  where head_row.tenant_id = checked_tenant_id;

  if tenant_count = 1 and head_count <> 1 then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.client_merge_head_missing';
  end if;
end;
$function$;

create or replace function public.inbox_v2_assert_client_merge_node_exists(
  checked_tenant_id text,
  checked_client_id text
)
returns void
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  client_count integer;
  node_count integer;
begin
  select count(*)::integer into client_count
  from public.clients client_row
  where client_row.tenant_id = checked_tenant_id
    and client_row.id = checked_client_id;

  select count(*)::integer into node_count
  from public.inbox_v2_client_merge_node_states node_row
  where node_row.tenant_id = checked_tenant_id
    and node_row.client_id = checked_client_id;

  if client_count = 1 and node_count <> 1 then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.client_merge_node_missing';
  end if;
end;
$function$;

create or replace function public.inbox_v2_client_merge_guard_head_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if new.revision is not null
     or new.updated_at is not null
     or new.latest_redirect_id is not null then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.client_merge_head_initial_state_invalid';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_client_merge_guard_node_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if new.state <> 'canonical_root'
     or new.next_client_id is not null
     or new.redirect_id is not null
     or new.maximum_inbound_depth <> 0
     or new.revision <> 1
     or new.last_graph_revision is not null then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.client_merge_node_initial_state_invalid';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_client_merge_guard_redirect_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  head_row public.inbox_v2_client_merge_graph_heads%rowtype;
  locked_row public.inbox_v2_client_merge_node_states%rowtype;
  source_row public.inbox_v2_client_merge_node_states%rowtype;
  target_row public.inbox_v2_client_merge_node_states%rowtype;
begin
  select * into head_row
  from public.inbox_v2_client_merge_graph_heads current_head
  where current_head.tenant_id = new.tenant_id
  for update;
  if not found then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.client_merge_head_missing';
  end if;

  for locked_row in
    select *
    from public.inbox_v2_client_merge_node_states node_row
    where node_row.tenant_id = new.tenant_id
      and node_row.client_id in (
        new.source_root_client_id,
        new.target_root_client_id
      )
    order by node_row.client_id collate "C"
    for update
  loop
    if locked_row.client_id = new.source_root_client_id then
      source_row := locked_row;
    elsif locked_row.client_id = new.target_root_client_id then
      target_row := locked_row;
    end if;
  end loop;

  if source_row.client_id is null or target_row.client_id is null then
    raise exception using
      errcode = '23503',
      message = 'inbox_v2.client_merge_root_missing';
  end if;
  if head_row.revision is distinct from new.current_graph_revision
     or head_row.updated_at is distinct from new.head_before_updated_at then
    raise exception using
      errcode = '40001',
      message = 'inbox_v2.client_merge_graph_revision_conflict';
  end if;
  if row(
       source_row.state,
       source_row.next_client_id,
       source_row.redirect_id,
       source_row.maximum_inbound_depth,
       source_row.revision,
       source_row.last_graph_revision,
       source_row.updated_at
     ) is distinct from row(
       new.source_before_state,
       new.source_before_next_client_id,
       new.source_before_redirect_id,
       new.source_before_maximum_inbound_depth,
       new.source_before_revision,
       new.source_before_last_graph_revision,
       new.source_before_updated_at
     )
     or row(
       target_row.state,
       target_row.next_client_id,
       target_row.redirect_id,
       target_row.maximum_inbound_depth,
       target_row.revision,
       target_row.last_graph_revision,
       target_row.updated_at
     ) is distinct from row(
       new.target_before_state,
       new.target_before_next_client_id,
       new.target_before_redirect_id,
       new.target_before_maximum_inbound_depth,
       new.target_before_revision,
       new.target_before_last_graph_revision,
       new.target_before_updated_at
     ) then
    raise exception using
      errcode = '40001',
      message = 'inbox_v2.client_merge_root_revision_conflict';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_client_merge_guard_node_update()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  redirect_row public.inbox_v2_client_merge_redirects%rowtype;
begin
  if new.tenant_id is distinct from old.tenant_id
     or new.client_id is distinct from old.client_id
     or new.last_graph_revision is null then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.client_merge_node_identity_invalid';
  end if;

  select * into redirect_row
  from public.inbox_v2_client_merge_redirects event_row
  where event_row.tenant_id = new.tenant_id
    and event_row.resulting_graph_revision = new.last_graph_revision;
  if not found then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.client_merge_node_event_missing';
  end if;

  if old.client_id = redirect_row.source_root_client_id then
    if row(
         old.state, old.next_client_id, old.redirect_id,
         old.maximum_inbound_depth, old.revision,
         old.last_graph_revision, old.updated_at
       ) is distinct from row(
         redirect_row.source_before_state,
         redirect_row.source_before_next_client_id,
         redirect_row.source_before_redirect_id,
         redirect_row.source_before_maximum_inbound_depth,
         redirect_row.source_before_revision,
         redirect_row.source_before_last_graph_revision,
         redirect_row.source_before_updated_at
       )
       or row(
         new.state, new.next_client_id, new.redirect_id,
         new.maximum_inbound_depth, new.revision,
         new.last_graph_revision, new.updated_at
       ) is distinct from row(
         redirect_row.source_after_state,
         redirect_row.source_after_next_client_id,
         redirect_row.source_after_redirect_id,
         redirect_row.source_after_maximum_inbound_depth,
         redirect_row.source_after_revision,
         redirect_row.source_after_last_graph_revision,
         redirect_row.source_after_updated_at
       ) then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.client_merge_source_projection_invalid';
    end if;
  elsif old.client_id = redirect_row.target_root_client_id then
    if row(
         old.state, old.next_client_id, old.redirect_id,
         old.maximum_inbound_depth, old.revision,
         old.last_graph_revision, old.updated_at
       ) is distinct from row(
         redirect_row.target_before_state,
         redirect_row.target_before_next_client_id,
         redirect_row.target_before_redirect_id,
         redirect_row.target_before_maximum_inbound_depth,
         redirect_row.target_before_revision,
         redirect_row.target_before_last_graph_revision,
         redirect_row.target_before_updated_at
       )
       or row(
         new.state, new.next_client_id, new.redirect_id,
         new.maximum_inbound_depth, new.revision,
         new.last_graph_revision, new.updated_at
       ) is distinct from row(
         redirect_row.target_after_state,
         redirect_row.target_after_next_client_id,
         redirect_row.target_after_redirect_id,
         redirect_row.target_after_maximum_inbound_depth,
         redirect_row.target_after_revision,
         redirect_row.target_after_last_graph_revision,
         redirect_row.target_after_updated_at
       ) then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.client_merge_target_projection_invalid';
    end if;
  else
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.client_merge_node_event_edge_invalid';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_client_merge_guard_head_update()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  redirect_row public.inbox_v2_client_merge_redirects%rowtype;
begin
  if new.tenant_id is distinct from old.tenant_id then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.client_merge_head_identity_invalid';
  end if;
  select * into redirect_row
  from public.inbox_v2_client_merge_redirects event_row
  where event_row.tenant_id = new.tenant_id
    and event_row.id = new.latest_redirect_id;
  if not found
     or old.revision is distinct from redirect_row.current_graph_revision
     or old.updated_at is distinct from redirect_row.head_before_updated_at
     or new.revision is distinct from redirect_row.resulting_graph_revision
     or new.updated_at is distinct from redirect_row.head_after_updated_at then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.client_merge_head_projection_invalid';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_assert_client_merge_commit(
  checked_tenant_id text,
  checked_resulting_revision bigint
)
returns void
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  redirect_row public.inbox_v2_client_merge_redirects%rowtype;
  head_row public.inbox_v2_client_merge_graph_heads%rowtype;
  source_row public.inbox_v2_client_merge_node_states%rowtype;
  target_row public.inbox_v2_client_merge_node_states%rowtype;
begin
  select * into redirect_row
  from public.inbox_v2_client_merge_redirects event_row
  where event_row.tenant_id = checked_tenant_id
    and event_row.resulting_graph_revision = checked_resulting_revision;
  if not found then
    return;
  end if;
  select * into head_row
  from public.inbox_v2_client_merge_graph_heads current_head
  where current_head.tenant_id = checked_tenant_id;
  select * into source_row
  from public.inbox_v2_client_merge_node_states current_node
  where current_node.tenant_id = checked_tenant_id
    and current_node.client_id = redirect_row.source_root_client_id;
  select * into target_row
  from public.inbox_v2_client_merge_node_states current_node
  where current_node.tenant_id = checked_tenant_id
    and current_node.client_id = redirect_row.target_root_client_id;

  if row(head_row.revision, head_row.updated_at, head_row.latest_redirect_id)
       is distinct from row(
         redirect_row.resulting_graph_revision,
         redirect_row.head_after_updated_at,
         redirect_row.id
       )
     or row(
       source_row.state, source_row.next_client_id, source_row.redirect_id,
       source_row.maximum_inbound_depth, source_row.revision,
       source_row.last_graph_revision, source_row.updated_at
     ) is distinct from row(
       redirect_row.source_after_state,
       redirect_row.source_after_next_client_id,
       redirect_row.source_after_redirect_id,
       redirect_row.source_after_maximum_inbound_depth,
       redirect_row.source_after_revision,
       redirect_row.source_after_last_graph_revision,
       redirect_row.source_after_updated_at
     )
     or row(
       target_row.state, target_row.next_client_id, target_row.redirect_id,
       target_row.maximum_inbound_depth, target_row.revision,
       target_row.last_graph_revision, target_row.updated_at
     ) is distinct from row(
       redirect_row.target_after_state,
       redirect_row.target_after_next_client_id,
       redirect_row.target_after_redirect_id,
       redirect_row.target_after_maximum_inbound_depth,
       redirect_row.target_after_revision,
       redirect_row.target_after_last_graph_revision,
       redirect_row.target_after_updated_at
     ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.client_merge_commit_projection_invalid';
  end if;
end;
$function$;

create or replace function public.inbox_v2_client_merge_deferred_tenant()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  perform public.inbox_v2_assert_client_merge_head_exists(
    coalesce(new.id, old.id)
  );
  return null;
end;
$function$;

create or replace function public.inbox_v2_client_merge_deferred_head()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  perform public.inbox_v2_assert_client_merge_head_exists(
    coalesce(new.tenant_id, old.tenant_id)
  );
  return null;
end;
$function$;

create or replace function public.inbox_v2_client_merge_deferred_client()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  perform public.inbox_v2_assert_client_merge_node_exists(
    coalesce(new.tenant_id, old.tenant_id),
    coalesce(new.id, old.id)
  );
  return null;
end;
$function$;

create or replace function public.inbox_v2_client_merge_deferred_node()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  perform public.inbox_v2_assert_client_merge_node_exists(
    coalesce(new.tenant_id, old.tenant_id),
    coalesce(new.client_id, old.client_id)
  );
  return null;
end;
$function$;

create or replace function public.inbox_v2_client_merge_deferred_redirect()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  perform public.inbox_v2_assert_client_merge_commit(
    new.tenant_id,
    new.resulting_graph_revision
  );
  return null;
end;
$function$;

create trigger inbox_v2_client_merge_redirects_insert_guard_trigger
before insert on public.inbox_v2_client_merge_redirects
for each row execute function public.inbox_v2_client_merge_guard_redirect_insert();

create trigger inbox_v2_client_merge_redirects_immutable_trigger
before update or delete on public.inbox_v2_client_merge_redirects
for each row execute function public.inbox_v2_client_merge_reject_immutable();

create trigger inbox_v2_tenants_client_merge_head_bootstrap_trigger
after insert on public.tenants
for each row execute function public.inbox_v2_client_merge_bootstrap_tenant_head();

create trigger inbox_v2_clients_merge_node_bootstrap_trigger
after insert on public.clients
for each row execute function public.inbox_v2_client_merge_bootstrap_client_node();

create trigger inbox_v2_client_merge_node_states_insert_guard_trigger
before insert on public.inbox_v2_client_merge_node_states
for each row execute function public.inbox_v2_client_merge_guard_node_insert();

create trigger inbox_v2_client_merge_node_states_update_guard_trigger
before update on public.inbox_v2_client_merge_node_states
for each row execute function public.inbox_v2_client_merge_guard_node_update();

create trigger inbox_v2_client_merge_graph_heads_insert_guard_trigger
before insert on public.inbox_v2_client_merge_graph_heads
for each row execute function public.inbox_v2_client_merge_guard_head_insert();

create trigger inbox_v2_client_merge_graph_heads_update_guard_trigger
before update on public.inbox_v2_client_merge_graph_heads
for each row execute function public.inbox_v2_client_merge_guard_head_update();

create constraint trigger inbox_v2_tenants_client_merge_head_constraint_trigger
after insert or update or delete on public.tenants
deferrable initially deferred
for each row execute function public.inbox_v2_client_merge_deferred_tenant();

create constraint trigger inbox_v2_client_merge_graph_heads_constraint_trigger
after insert or update or delete on public.inbox_v2_client_merge_graph_heads
deferrable initially deferred
for each row execute function public.inbox_v2_client_merge_deferred_head();

create constraint trigger inbox_v2_clients_merge_node_constraint_trigger
after insert or update or delete on public.clients
deferrable initially deferred
for each row execute function public.inbox_v2_client_merge_deferred_client();

create constraint trigger inbox_v2_client_merge_node_states_constraint_trigger
after insert or update or delete on public.inbox_v2_client_merge_node_states
deferrable initially deferred
for each row execute function public.inbox_v2_client_merge_deferred_node();

create constraint trigger inbox_v2_client_merge_redirects_constraint_trigger
after insert on public.inbox_v2_client_merge_redirects
deferrable initially deferred
for each row execute function public.inbox_v2_client_merge_deferred_redirect();
`;
