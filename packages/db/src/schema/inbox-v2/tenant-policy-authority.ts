import { sql, type SQLWrapper } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique
} from "drizzle-orm/pg-core";

import { employees, tenants } from "../tables";

export const inboxV2TenantPolicyFamily = pgEnum(
  "inbox_v2_tenant_policy_family",
  ["source_identity_claim", "conversation_client_link"]
);

export const inboxV2TenantPolicyActivationState = pgEnum(
  "inbox_v2_tenant_policy_activation_state",
  ["active", "revoked"]
);

export const inboxV2TenantPolicyActivationOperation = pgEnum(
  "inbox_v2_tenant_policy_activation_operation",
  ["activate", "revoke"]
);

/** One tenant approval for one immutable, content-addressed policy version. */
export const inboxV2TenantPolicyVersions = pgTable(
  "inbox_v2_tenant_policy_versions",
  {
    tenantId: text("tenant_id").notNull(),
    family: inboxV2TenantPolicyFamily("family").notNull(),
    policyId: text("policy_id").notNull(),
    policyVersion: text("policy_version").notNull(),
    definitionContractVersion: text("definition_contract_version").notNull(),
    definitionDigestSha256: text("definition_digest_sha256").notNull(),
    approvedTrustedServiceId: text("approved_trusted_service_id").notNull(),
    approvedByEmployeeId: text("approved_by_employee_id").notNull(),
    approvedAt: timestamp("approved_at", {
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
      name: "inbox_v2_tenant_policy_versions_pk",
      columns: [
        table.tenantId,
        table.family,
        table.policyId,
        table.policyVersion
      ]
    }),
    foreignKey({
      name: "inbox_v2_tenant_policy_versions_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_tenant_policy_versions_approver_fk",
      columns: [table.tenantId, table.approvedByEmployeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }),
    unique("inbox_v2_tenant_policy_versions_exact_target_unique").on(
      table.tenantId,
      table.family,
      table.policyId,
      table.policyVersion,
      table.definitionContractVersion,
      table.definitionDigestSha256,
      table.approvedTrustedServiceId
    ),
    check(
      "inbox_v2_tenant_policy_versions_values_check",
      sql`${catalogIdSql(table.policyId)}
        and ${versionTokenSql(table.policyVersion)}
        and ${versionTokenSql(table.definitionContractVersion)}
        and ${sha256DigestSql(table.definitionDigestSha256)}
        and ${catalogIdSql(table.approvedTrustedServiceId)}
        and ${table.revision} = 1`
    ),
    check(
      "inbox_v2_tenant_policy_versions_timestamps_check",
      sql`isfinite(${table.approvedAt})
        and isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and ${table.approvedAt} = ${table.createdAt}
        and ${table.createdAt} = ${table.updatedAt}`
    ),
    index("inbox_v2_tenant_policy_versions_tenant_family_idx").on(
      table.tenantId,
      table.family,
      table.policyId,
      table.policyVersion
    )
  ]
);

/** Mutable current activation fence; policy definitions remain immutable. */
export const inboxV2TenantPolicyActivationHeads = pgTable(
  "inbox_v2_tenant_policy_activation_heads",
  {
    tenantId: text("tenant_id").notNull(),
    family: inboxV2TenantPolicyFamily("family").notNull(),
    policyId: text("policy_id").notNull(),
    policyVersion: text("policy_version").notNull(),
    definitionContractVersion: text("definition_contract_version").notNull(),
    definitionDigestSha256: text("definition_digest_sha256").notNull(),
    approvedTrustedServiceId: text("approved_trusted_service_id").notNull(),
    state: inboxV2TenantPolicyActivationState("state").notNull(),
    activatedByEmployeeId: text("activated_by_employee_id").notNull(),
    activatedAt: timestamp("activated_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    revokedByEmployeeId: text("revoked_by_employee_id"),
    revokedAt: timestamp("revoked_at", {
      withTimezone: true,
      precision: 3
    }),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
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
      name: "inbox_v2_tenant_policy_activation_heads_pk",
      columns: [table.tenantId, table.family, table.policyId]
    }),
    foreignKey({
      name: "inbox_v2_tenant_policy_activation_heads_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_tenant_policy_activation_heads_version_fk",
      columns: [
        table.tenantId,
        table.family,
        table.policyId,
        table.policyVersion,
        table.definitionContractVersion,
        table.definitionDigestSha256,
        table.approvedTrustedServiceId
      ],
      foreignColumns: [
        inboxV2TenantPolicyVersions.tenantId,
        inboxV2TenantPolicyVersions.family,
        inboxV2TenantPolicyVersions.policyId,
        inboxV2TenantPolicyVersions.policyVersion,
        inboxV2TenantPolicyVersions.definitionContractVersion,
        inboxV2TenantPolicyVersions.definitionDigestSha256,
        inboxV2TenantPolicyVersions.approvedTrustedServiceId
      ]
    }),
    foreignKey({
      name: "inbox_v2_tenant_policy_activation_heads_activator_fk",
      columns: [table.tenantId, table.activatedByEmployeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }),
    foreignKey({
      name: "inbox_v2_tenant_policy_activation_heads_revoker_fk",
      columns: [table.tenantId, table.revokedByEmployeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }),
    foreignKey({
      name: "inbox_v2_tenant_policy_activation_heads_transition_fk",
      columns: [table.tenantId, table.family, table.policyId, table.revision],
      foreignColumns: [
        inboxV2TenantPolicyActivationTransitions.tenantId,
        inboxV2TenantPolicyActivationTransitions.family,
        inboxV2TenantPolicyActivationTransitions.policyId,
        inboxV2TenantPolicyActivationTransitions.resultingHeadRevision
      ]
    }),
    check(
      "inbox_v2_tenant_policy_activation_heads_values_check",
      sql`${catalogIdSql(table.policyId)}
        and ${versionTokenSql(table.policyVersion)}
        and ${versionTokenSql(table.definitionContractVersion)}
        and ${sha256DigestSql(table.definitionDigestSha256)}
        and ${catalogIdSql(table.approvedTrustedServiceId)}
        and ${table.revision} >= 1`
    ),
    check(
      "inbox_v2_tenant_policy_activation_heads_state_check",
      sql`(
          ${table.state} = 'active'
          and ${table.revokedByEmployeeId} is null
          and ${table.revokedAt} is null
          and ${table.updatedAt} = ${table.activatedAt}
        ) or (
          ${table.state} = 'revoked'
          and ${table.revokedByEmployeeId} is not null
          and ${table.revokedAt} is not null
          and ${table.revokedAt} >= ${table.activatedAt}
          and ${table.updatedAt} = ${table.revokedAt}
        )`
    ),
    check(
      "inbox_v2_tenant_policy_activation_heads_timestamps_check",
      sql`isfinite(${table.activatedAt})
        and isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and (${table.revokedAt} is null or isfinite(${table.revokedAt}))
        and ${table.createdAt} <= ${table.activatedAt}`
    ),
    index("inbox_v2_tenant_policy_activation_heads_tenant_state_idx").on(
      table.tenantId,
      table.state,
      table.family,
      table.policyId
    )
  ]
);

/** Immutable activation/revocation history behind the compact current head. */
export const inboxV2TenantPolicyActivationTransitions = pgTable(
  "inbox_v2_tenant_policy_activation_transitions",
  {
    tenantId: text("tenant_id").notNull(),
    family: inboxV2TenantPolicyFamily("family").notNull(),
    policyId: text("policy_id").notNull(),
    operation: inboxV2TenantPolicyActivationOperation("operation").notNull(),
    expectedHeadRevision: bigint("expected_head_revision", { mode: "bigint" }),
    resultingHeadRevision: bigint("resulting_head_revision", {
      mode: "bigint"
    }).notNull(),
    previousState: inboxV2TenantPolicyActivationState("previous_state"),
    previousPolicyVersion: text("previous_policy_version"),
    previousDefinitionContractVersion: text(
      "previous_definition_contract_version"
    ),
    previousDefinitionDigestSha256: text("previous_definition_digest_sha256"),
    previousApprovedTrustedServiceId: text(
      "previous_approved_trusted_service_id"
    ),
    resultingState:
      inboxV2TenantPolicyActivationState("resulting_state").notNull(),
    resultingPolicyVersion: text("resulting_policy_version").notNull(),
    resultingDefinitionContractVersion: text(
      "resulting_definition_contract_version"
    ).notNull(),
    resultingDefinitionDigestSha256: text(
      "resulting_definition_digest_sha256"
    ).notNull(),
    resultingApprovedTrustedServiceId: text(
      "resulting_approved_trusted_service_id"
    ).notNull(),
    actorEmployeeId: text("actor_employee_id").notNull(),
    occurredAt: timestamp("occurred_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_tenant_policy_activation_transitions_pk",
      columns: [
        table.tenantId,
        table.family,
        table.policyId,
        table.resultingHeadRevision
      ]
    }),
    unique("inbox_v2_tenant_policy_transition_exact_authority_unique").on(
      table.tenantId,
      table.family,
      table.policyId,
      table.resultingHeadRevision,
      table.resultingPolicyVersion,
      table.resultingDefinitionContractVersion,
      table.resultingDefinitionDigestSha256,
      table.resultingApprovedTrustedServiceId
    ),
    foreignKey({
      name: "inbox_v2_tenant_policy_activation_transitions_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_tenant_policy_activation_transitions_actor_fk",
      columns: [table.tenantId, table.actorEmployeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }),
    foreignKey({
      name: "inbox_v2_tenant_policy_activation_transitions_previous_fk",
      columns: [
        table.tenantId,
        table.family,
        table.policyId,
        table.previousPolicyVersion,
        table.previousDefinitionContractVersion,
        table.previousDefinitionDigestSha256,
        table.previousApprovedTrustedServiceId
      ],
      foreignColumns: [
        inboxV2TenantPolicyVersions.tenantId,
        inboxV2TenantPolicyVersions.family,
        inboxV2TenantPolicyVersions.policyId,
        inboxV2TenantPolicyVersions.policyVersion,
        inboxV2TenantPolicyVersions.definitionContractVersion,
        inboxV2TenantPolicyVersions.definitionDigestSha256,
        inboxV2TenantPolicyVersions.approvedTrustedServiceId
      ]
    }),
    foreignKey({
      name: "inbox_v2_tenant_policy_activation_transitions_resulting_fk",
      columns: [
        table.tenantId,
        table.family,
        table.policyId,
        table.resultingPolicyVersion,
        table.resultingDefinitionContractVersion,
        table.resultingDefinitionDigestSha256,
        table.resultingApprovedTrustedServiceId
      ],
      foreignColumns: [
        inboxV2TenantPolicyVersions.tenantId,
        inboxV2TenantPolicyVersions.family,
        inboxV2TenantPolicyVersions.policyId,
        inboxV2TenantPolicyVersions.policyVersion,
        inboxV2TenantPolicyVersions.definitionContractVersion,
        inboxV2TenantPolicyVersions.definitionDigestSha256,
        inboxV2TenantPolicyVersions.approvedTrustedServiceId
      ]
    }),
    check(
      "inbox_v2_tenant_policy_activation_transitions_revision_check",
      sql`${table.resultingHeadRevision} =
          coalesce(${table.expectedHeadRevision}, 0) + 1`
    ),
    check(
      "inbox_v2_tenant_policy_activation_transitions_shape_check",
      sql`(
          ${table.operation} = 'activate'
          and ${table.resultingState} = 'active'
          and (
            (
              ${table.expectedHeadRevision} is null
              and ${table.previousState} is null
              and ${table.previousPolicyVersion} is null
              and ${table.previousDefinitionContractVersion} is null
              and ${table.previousDefinitionDigestSha256} is null
              and ${table.previousApprovedTrustedServiceId} is null
            ) or (
              ${table.expectedHeadRevision} is not null
              and ${table.previousState} = 'revoked'
              and ${table.previousPolicyVersion} is not null
              and ${table.previousDefinitionContractVersion} is not null
              and ${table.previousDefinitionDigestSha256} is not null
              and ${table.previousApprovedTrustedServiceId} is not null
            )
          )
        ) or (
          ${table.operation} = 'revoke'
          and ${table.expectedHeadRevision} is not null
          and ${table.previousState} = 'active'
          and ${table.resultingState} = 'revoked'
          and row(
            ${table.previousPolicyVersion},
            ${table.previousDefinitionContractVersion},
            ${table.previousDefinitionDigestSha256},
            ${table.previousApprovedTrustedServiceId}
          ) = row(
            ${table.resultingPolicyVersion},
            ${table.resultingDefinitionContractVersion},
            ${table.resultingDefinitionDigestSha256},
            ${table.resultingApprovedTrustedServiceId}
          )
        )`
    ),
    check(
      "inbox_v2_tenant_policy_activation_transitions_values_check",
      sql`${catalogIdSql(table.policyId)}
        and ${versionTokenSql(table.resultingPolicyVersion)}
        and ${versionTokenSql(table.resultingDefinitionContractVersion)}
        and ${sha256DigestSql(table.resultingDefinitionDigestSha256)}
        and ${catalogIdSql(table.resultingApprovedTrustedServiceId)}
        and (
          ${table.previousPolicyVersion} is null
          or (
            ${versionTokenSql(table.previousPolicyVersion)}
            and ${versionTokenSql(table.previousDefinitionContractVersion)}
            and ${sha256DigestSql(table.previousDefinitionDigestSha256)}
            and ${catalogIdSql(table.previousApprovedTrustedServiceId)}
          )
        )`
    ),
    check(
      "inbox_v2_tenant_policy_activation_transitions_timestamps_check",
      sql`isfinite(${table.occurredAt})
        and isfinite(${table.createdAt})
        and ${table.occurredAt} = ${table.createdAt}`
    ),
    index("inbox_v2_tenant_policy_activation_transitions_tenant_time_idx").on(
      table.tenantId,
      table.occurredAt,
      table.family,
      table.policyId
    )
  ]
);

/**
 * Database-side invariants used by the generated migration. The version row is
 * immutable; the activation head accepts only monotonic active->revoked or
 * revoked->active revision transitions and locks the exact version proof.
 */
export const INBOX_V2_TENANT_POLICY_AUTHORITY_INTEGRITY_SQL = String.raw`
create or replace function public.inbox_v2_tenant_policy_version_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  employee_created_at timestamptz;
  employee_deactivated_at timestamptz;
begin
  if tg_op = 'DELETE' then
    if not exists (
      select 1 from public.tenants tenant_row where tenant_row.id = old.tenant_id
    ) then
      return old;
    end if;
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.tenant_policy_version_immutable';
  end if;

  if tg_op = 'UPDATE' then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.tenant_policy_version_immutable';
  end if;

  select employee_row.created_at, employee_row.deactivated_at
    into employee_created_at, employee_deactivated_at
    from public.employees employee_row
   where employee_row.tenant_id = new.tenant_id
     and employee_row.id = new.approved_by_employee_id
   for share;

  if not found
     or employee_created_at > new.approved_at
     or (
       employee_deactivated_at is not null
       and employee_deactivated_at <= new.approved_at
     ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.tenant_policy_approver_invalid';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_tenant_policy_activation_transition_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  head_row public.inbox_v2_tenant_policy_activation_heads%rowtype;
  version_approved_at timestamptz;
  actor_created_at timestamptz;
  actor_deactivated_at timestamptz;
begin
  if tg_op = 'DELETE' then
    if not exists (
      select 1 from public.tenants tenant_row where tenant_row.id = old.tenant_id
    ) then
      return old;
    end if;
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.tenant_policy_activation_transition_immutable';
  end if;

  if tg_op = 'UPDATE' then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.tenant_policy_activation_transition_immutable';
  end if;

  select * into head_row
    from public.inbox_v2_tenant_policy_activation_heads head_candidate
   where head_candidate.tenant_id = new.tenant_id
     and head_candidate.family = new.family
     and head_candidate.policy_id = new.policy_id
   for update;

  if new.expected_head_revision is null then
    if found or new.resulting_head_revision <> 1
       or new.previous_state is not null then
      raise exception using
        errcode = '40001',
        message = 'inbox_v2.tenant_policy_activation_cas_conflict';
    end if;
  else
    if not found
       or head_row.revision <> new.expected_head_revision
       or new.resulting_head_revision <> new.expected_head_revision + 1
       or row(
         new.previous_state,
         new.previous_policy_version,
         new.previous_definition_contract_version,
         new.previous_definition_digest_sha256,
         new.previous_approved_trusted_service_id
       ) is distinct from row(
         head_row.state,
         head_row.policy_version,
         head_row.definition_contract_version,
         head_row.definition_digest_sha256,
         head_row.approved_trusted_service_id
       ) then
      raise exception using
        errcode = '40001',
        message = 'inbox_v2.tenant_policy_activation_cas_conflict';
    end if;
  end if;

  if new.operation = 'activate' then
    if new.resulting_state <> 'active'
       or (
         new.expected_head_revision is not null
         and (
           head_row.state <> 'revoked'
           or new.occurred_at < head_row.revoked_at
         )
       ) then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.tenant_policy_activation_transition_invalid';
    end if;
  elsif new.operation = 'revoke' then
    if new.expected_head_revision is null
       or head_row.state <> 'active'
       or new.resulting_state <> 'revoked'
       or row(
         new.resulting_policy_version,
         new.resulting_definition_contract_version,
         new.resulting_definition_digest_sha256,
         new.resulting_approved_trusted_service_id
       ) is distinct from row(
         head_row.policy_version,
         head_row.definition_contract_version,
         head_row.definition_digest_sha256,
         head_row.approved_trusted_service_id
       )
       or new.occurred_at < head_row.activated_at then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.tenant_policy_revocation_transition_invalid';
    end if;
  end if;

  select version_row.approved_at
    into version_approved_at
    from public.inbox_v2_tenant_policy_versions version_row
   where version_row.tenant_id = new.tenant_id
     and version_row.family = new.family
     and version_row.policy_id = new.policy_id
     and version_row.policy_version = new.resulting_policy_version
     and version_row.definition_contract_version =
         new.resulting_definition_contract_version
     and version_row.definition_digest_sha256 =
         new.resulting_definition_digest_sha256
     and version_row.approved_trusted_service_id =
         new.resulting_approved_trusted_service_id
   for share;

  if not found or version_approved_at > new.occurred_at then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.tenant_policy_activation_version_invalid';
  end if;

  select employee_row.created_at, employee_row.deactivated_at
    into actor_created_at, actor_deactivated_at
    from public.employees employee_row
   where employee_row.tenant_id = new.tenant_id
     and employee_row.id = new.actor_employee_id
   for share;

  if not found
     or actor_created_at > new.occurred_at
     or (
       actor_deactivated_at is not null
       and actor_deactivated_at <= new.occurred_at
     ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.tenant_policy_activation_actor_invalid';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_tenant_policy_activation_head_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  version_approved_at timestamptz;
  transition_exists boolean;
  actor_id text;
  actor_at timestamptz;
  actor_created_at timestamptz;
  actor_deactivated_at timestamptz;
begin
  if tg_op = 'DELETE' then
    if not exists (
      select 1 from public.tenants tenant_row where tenant_row.id = old.tenant_id
    ) then
      return old;
    end if;
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.tenant_policy_activation_head_delete_forbidden';
  end if;

  select exists (
    select 1
      from public.inbox_v2_tenant_policy_activation_transitions transition_row
     where transition_row.tenant_id = new.tenant_id
       and transition_row.family = new.family
       and transition_row.policy_id = new.policy_id
       and transition_row.resulting_head_revision = new.revision
       and transition_row.resulting_state = new.state
       and transition_row.resulting_policy_version = new.policy_version
       and transition_row.resulting_definition_contract_version =
           new.definition_contract_version
       and transition_row.resulting_definition_digest_sha256 =
           new.definition_digest_sha256
       and transition_row.resulting_approved_trusted_service_id =
           new.approved_trusted_service_id
       and (
         (
           new.state = 'active'
           and transition_row.operation = 'activate'
           and transition_row.actor_employee_id = new.activated_by_employee_id
           and transition_row.occurred_at = new.activated_at
         ) or (
           new.state = 'revoked'
           and transition_row.operation = 'revoke'
           and transition_row.actor_employee_id = new.revoked_by_employee_id
           and transition_row.occurred_at = new.revoked_at
         )
       )
  ) into transition_exists;

  if not transition_exists then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.tenant_policy_activation_transition_missing';
  end if;

  select version_row.approved_at
    into version_approved_at
    from public.inbox_v2_tenant_policy_versions version_row
   where version_row.tenant_id = new.tenant_id
     and version_row.family = new.family
     and version_row.policy_id = new.policy_id
     and version_row.policy_version = new.policy_version
     and version_row.definition_contract_version =
         new.definition_contract_version
     and version_row.definition_digest_sha256 = new.definition_digest_sha256
     and version_row.approved_trusted_service_id =
         new.approved_trusted_service_id
   for share;

  if not found or version_approved_at > new.activated_at then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.tenant_policy_activation_version_invalid';
  end if;

  if tg_op = 'INSERT' then
    if new.state <> 'active'
       or new.revision <> 1
       or new.created_at <> new.activated_at then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.tenant_policy_activation_bootstrap_invalid';
    end if;
    actor_id := new.activated_by_employee_id;
    actor_at := new.activated_at;
  else
    if row(new.tenant_id, new.family, new.policy_id, new.created_at)
       is distinct from
       row(old.tenant_id, old.family, old.policy_id, old.created_at)
       or new.revision <> old.revision + 1 then
      raise exception using
        errcode = '40001',
        message = 'inbox_v2.tenant_policy_activation_cas_conflict';
    end if;

    if old.state = 'active' then
      if new.state <> 'revoked'
         or row(
           new.policy_version,
           new.definition_contract_version,
           new.definition_digest_sha256,
           new.approved_trusted_service_id,
           new.activated_by_employee_id,
           new.activated_at
         ) is distinct from row(
           old.policy_version,
           old.definition_contract_version,
           old.definition_digest_sha256,
           old.approved_trusted_service_id,
           old.activated_by_employee_id,
           old.activated_at
         ) then
        raise exception using
          errcode = '23514',
          message = 'inbox_v2.tenant_policy_revocation_transition_invalid';
      end if;
      actor_id := new.revoked_by_employee_id;
      actor_at := new.revoked_at;
    else
      if new.state <> 'active'
         or new.revoked_by_employee_id is not null
         or new.revoked_at is not null
         or new.activated_at < old.revoked_at then
        raise exception using
          errcode = '23514',
          message = 'inbox_v2.tenant_policy_reactivation_transition_invalid';
      end if;
      actor_id := new.activated_by_employee_id;
      actor_at := new.activated_at;
    end if;
  end if;

  select employee_row.created_at, employee_row.deactivated_at
    into actor_created_at, actor_deactivated_at
    from public.employees employee_row
   where employee_row.tenant_id = new.tenant_id
     and employee_row.id = actor_id
   for share;

  if actor_id is null
     or actor_at is null
     or not found
     or actor_created_at > actor_at
     or (
       actor_deactivated_at is not null
       and actor_deactivated_at <= actor_at
     ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.tenant_policy_activation_actor_invalid';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_assert_tenant_policy_transition_materialized()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  perform 1
    from public.inbox_v2_tenant_policy_activation_heads head_row
   where head_row.tenant_id = new.tenant_id
     and head_row.family = new.family
     and head_row.policy_id = new.policy_id
     and head_row.revision = new.resulting_head_revision
     and head_row.state = new.resulting_state
     and head_row.policy_version = new.resulting_policy_version
     and head_row.definition_contract_version =
         new.resulting_definition_contract_version
     and head_row.definition_digest_sha256 =
         new.resulting_definition_digest_sha256
     and head_row.approved_trusted_service_id =
         new.resulting_approved_trusted_service_id
     and (
       (
         new.operation = 'activate'
         and head_row.activated_by_employee_id = new.actor_employee_id
         and head_row.activated_at = new.occurred_at
         and head_row.revoked_at is null
       ) or (
         new.operation = 'revoke'
         and head_row.revoked_by_employee_id = new.actor_employee_id
         and head_row.revoked_at = new.occurred_at
       )
     );

  if not found then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.tenant_policy_activation_transition_unmaterialized';
  end if;
  return null;
end;
$function$;

create trigger inbox_v2_tenant_policy_versions_guard_trigger
before insert or update or delete on public.inbox_v2_tenant_policy_versions
for each row execute function public.inbox_v2_tenant_policy_version_guard();

create trigger inbox_v2_tenant_policy_activation_transitions_guard_trigger
before insert or update or delete
on public.inbox_v2_tenant_policy_activation_transitions
for each row execute function public.inbox_v2_tenant_policy_activation_transition_guard();

create trigger inbox_v2_tenant_policy_activation_heads_guard_trigger
before insert or update or delete on public.inbox_v2_tenant_policy_activation_heads
for each row execute function public.inbox_v2_tenant_policy_activation_head_guard();

create constraint trigger inbox_v2_tenant_policy_transition_materialized_constraint
after insert on public.inbox_v2_tenant_policy_activation_transitions
deferrable initially deferred
for each row execute function public.inbox_v2_assert_tenant_policy_transition_materialized();
`;

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

function sha256DigestSql(column: SQLWrapper) {
  return sql`${column} ~ '^[a-f0-9]{64}$'`;
}
