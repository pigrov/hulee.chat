import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex
} from "drizzle-orm/pg-core";

import { tenants } from "../tables";
import {
  inboxV2OutboxIntents,
  inboxV2TenantStreamCommits,
  inboxV2TenantStreamHeads
} from "./authorization-relations";

export const inboxV2ProjectionGenerationState = pgEnum(
  "inbox_v2_projection_generation_state",
  ["shadow", "active", "retired"]
);

export const inboxV2OutboxWorkState = pgEnum("inbox_v2_outbox_work_state", [
  "pending",
  "leased",
  "processed",
  "dead"
]);

export const inboxV2OutboxOutcomeKind = pgEnum("inbox_v2_outbox_outcome_kind", [
  "retry",
  "processed",
  "dead"
]);

/**
 * Immutable identity and lifecycle metadata for one projection generation.
 * A shadow generation can catch up without replacing the current reader head.
 */
export const inboxV2ProjectionGenerations = pgTable(
  "inbox_v2_projection_generations",
  {
    tenantId: text("tenant_id").notNull(),
    projectionId: text("projection_id").notNull(),
    scopeId: text("scope_id").notNull(),
    generation: bigint("generation", { mode: "bigint" }).notNull(),
    streamEpoch: text("stream_epoch").notNull(),
    projectionSchemaVersion: text("projection_schema_version").notNull(),
    state: inboxV2ProjectionGenerationState("state").notNull(),
    minRetainedPosition: bigint("min_retained_position", {
      mode: "bigint"
    }).notNull(),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    activatedAt: timestamp("activated_at", {
      withTimezone: true,
      precision: 3
    }),
    retiredAt: timestamp("retired_at", {
      withTimezone: true,
      precision: 3
    }),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_projection_generations_pk",
      columns: [
        table.tenantId,
        table.projectionId,
        table.scopeId,
        table.generation
      ]
    }),
    unique("inbox_v2_projection_generations_epoch_unique").on(
      table.tenantId,
      table.projectionId,
      table.scopeId,
      table.generation,
      table.streamEpoch
    ),
    uniqueIndex("inbox_v2_projection_generations_current_unique")
      .on(table.tenantId, table.projectionId, table.scopeId)
      .where(sql`${table.state} = 'active'`),
    foreignKey({
      name: "inbox_v2_projection_generations_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_projection_generations_stream_fk",
      columns: [table.tenantId],
      foreignColumns: [inboxV2TenantStreamHeads.tenantId]
    }).onDelete("cascade"),
    check(
      "inbox_v2_projection_generations_values_check",
      sql`${table.generation} >= 1
        and ${table.minRetainedPosition} >= 0
        and ${table.revision} >= 1
        and char_length(${table.projectionId}) between 3 and 256
        and char_length(${table.scopeId}) between 1 and 256
        and char_length(${table.streamEpoch}) between 8 and 256
        and char_length(${table.projectionSchemaVersion}) between 1 and 64`
    ),
    check(
      "inbox_v2_projection_generations_state_check",
      sql`(${table.state} = 'shadow'
          and ${table.activatedAt} is null
          and ${table.retiredAt} is null)
        or (${table.state} = 'active'
          and ${table.activatedAt} is not null
          and ${table.retiredAt} is null)
        or (${table.state} = 'retired'
          and ${table.activatedAt} is not null
          and ${table.retiredAt} is not null)`
    ),
    check(
      "inbox_v2_projection_generations_times_check",
      sql`isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and ${table.updatedAt} >= ${table.createdAt}
        and (${table.activatedAt} is null or (
          isfinite(${table.activatedAt})
          and ${table.activatedAt} between ${table.createdAt} and ${table.updatedAt}
        ))
        and (${table.retiredAt} is null or (
          isfinite(${table.retiredAt})
          and ${table.retiredAt} between ${table.createdAt} and ${table.updatedAt}
          and (${table.activatedAt} is null
            or ${table.retiredAt} >= ${table.activatedAt})
        ))`
    ),
    index("inbox_v2_projection_generations_worker_idx")
      .on(
        table.tenantId,
        table.projectionId,
        table.state,
        table.minRetainedPosition,
        table.scopeId,
        table.generation
      )
      .where(sql`${table.state} = 'shadow'`)
  ]
);

/** The only reader-visible generation pointer for a projection scope. */
export const inboxV2ProjectionHeads = pgTable(
  "inbox_v2_projection_heads",
  {
    tenantId: text("tenant_id").notNull(),
    projectionId: text("projection_id").notNull(),
    scopeId: text("scope_id").notNull(),
    currentGeneration: bigint("current_generation", {
      mode: "bigint"
    }).notNull(),
    streamEpoch: text("stream_epoch").notNull(),
    projectionSchemaVersion: text("projection_schema_version").notNull(),
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
      name: "inbox_v2_projection_heads_pk",
      columns: [table.tenantId, table.projectionId, table.scopeId]
    }),
    foreignKey({
      name: "inbox_v2_projection_heads_generation_fk",
      columns: [
        table.tenantId,
        table.projectionId,
        table.scopeId,
        table.currentGeneration,
        table.streamEpoch
      ],
      foreignColumns: [
        inboxV2ProjectionGenerations.tenantId,
        inboxV2ProjectionGenerations.projectionId,
        inboxV2ProjectionGenerations.scopeId,
        inboxV2ProjectionGenerations.generation,
        inboxV2ProjectionGenerations.streamEpoch
      ]
    }).onDelete("cascade"),
    check(
      "inbox_v2_projection_heads_values_check",
      sql`${table.currentGeneration} >= 1
        and ${table.revision} >= 1
        and char_length(${table.projectionSchemaVersion}) between 1 and 64`
    ),
    check(
      "inbox_v2_projection_heads_times_check",
      sql`isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and ${table.updatedAt} >= ${table.createdAt}`
    )
  ]
);

/** Contiguous durable consumer checkpoint; every commit advances by one. */
export const inboxV2ProjectionCheckpoints = pgTable(
  "inbox_v2_projection_checkpoints",
  {
    tenantId: text("tenant_id").notNull(),
    projectionId: text("projection_id").notNull(),
    scopeId: text("scope_id").notNull(),
    generation: bigint("generation", { mode: "bigint" }).notNull(),
    streamEpoch: text("stream_epoch").notNull(),
    position: bigint("position", { mode: "bigint" }).notNull(),
    lastCommitId: text("last_commit_id"),
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
      name: "inbox_v2_projection_checkpoints_pk",
      columns: [
        table.tenantId,
        table.projectionId,
        table.scopeId,
        table.generation
      ]
    }),
    foreignKey({
      name: "inbox_v2_projection_checkpoints_generation_fk",
      columns: [
        table.tenantId,
        table.projectionId,
        table.scopeId,
        table.generation,
        table.streamEpoch
      ],
      foreignColumns: [
        inboxV2ProjectionGenerations.tenantId,
        inboxV2ProjectionGenerations.projectionId,
        inboxV2ProjectionGenerations.scopeId,
        inboxV2ProjectionGenerations.generation,
        inboxV2ProjectionGenerations.streamEpoch
      ]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_projection_checkpoints_commit_fk",
      columns: [
        table.tenantId,
        table.lastCommitId,
        table.streamEpoch,
        table.position
      ],
      foreignColumns: [
        inboxV2TenantStreamCommits.tenantId,
        inboxV2TenantStreamCommits.id,
        inboxV2TenantStreamCommits.streamEpoch,
        inboxV2TenantStreamCommits.position
      ]
    }),
    check(
      "inbox_v2_projection_checkpoints_values_check",
      sql`${table.generation} >= 1
        and ${table.position} >= 0
        and ${table.revision} >= 1
        and (${table.position} > 0
          or ${table.lastCommitId} is null)
        and (${table.lastCommitId} is null
          or char_length(${table.lastCommitId}) between 1 and 256)`
    ),
    check(
      "inbox_v2_projection_checkpoints_times_check",
      sql`isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and ${table.updatedAt} >= ${table.createdAt}`
    ),
    index("inbox_v2_projection_checkpoints_catchup_idx").on(
      table.tenantId,
      table.projectionId,
      table.position,
      table.scopeId,
      table.generation
    )
  ]
);

/** Mutable delivery state, deliberately separate from immutable outbox intent. */
export const inboxV2OutboxWorkItems = pgTable(
  "inbox_v2_outbox_work_items",
  {
    tenantId: text("tenant_id").notNull(),
    intentId: text("intent_id").notNull(),
    state: inboxV2OutboxWorkState("state").notNull(),
    attemptCount: bigint("attempt_count", { mode: "bigint" }).notNull(),
    availableAt: timestamp("available_at", {
      withTimezone: true,
      precision: 3
    }),
    leaseOwnerId: text("lease_owner_id"),
    leaseTokenHash: text("lease_token_hash"),
    leaseRevision: bigint("lease_revision", { mode: "bigint" }),
    leaseClaimedAt: timestamp("lease_claimed_at", {
      withTimezone: true,
      precision: 3
    }),
    leaseExpiresAt: timestamp("lease_expires_at", {
      withTimezone: true,
      precision: 3
    }),
    lastRetryResultHash: text("last_retry_result_hash"),
    lastRetryErrorCode: text("last_retry_error_code"),
    lastRetryAvailableAt: timestamp("last_retry_available_at", {
      withTimezone: true,
      precision: 3
    }),
    lastRetryRecordedAt: timestamp("last_retry_recorded_at", {
      withTimezone: true,
      precision: 3
    }),
    terminalResultHash: text("terminal_result_hash"),
    terminalErrorCode: text("terminal_error_code"),
    legacyTerminalResultReference: jsonb("terminal_result_reference").$type<
      Readonly<Record<string, unknown>>
    >(),
    terminalFinalizedAt: timestamp("terminal_finalized_at", {
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
      name: "inbox_v2_outbox_work_items_pk",
      columns: [table.tenantId, table.intentId]
    }),
    foreignKey({
      name: "inbox_v2_outbox_work_items_intent_fk",
      columns: [table.tenantId, table.intentId],
      foreignColumns: [inboxV2OutboxIntents.tenantId, inboxV2OutboxIntents.id]
    }).onDelete("cascade"),
    uniqueIndex("inbox_v2_outbox_work_items_lease_token_unique")
      .on(table.tenantId, table.leaseTokenHash)
      .where(sql`${table.leaseTokenHash} is not null`),
    check(
      "inbox_v2_outbox_work_items_values_check",
      sql`${table.attemptCount} >= 0
        and ${table.revision} >= 1
        and (${table.leaseOwnerId} is null
          or char_length(${table.leaseOwnerId}) between 1 and 256)
        and (${table.leaseTokenHash} is null
          or ${table.leaseTokenHash} ~ '^sha256:[0-9a-f]{64}$')
        and (${table.leaseRevision} is null or ${table.leaseRevision} >= 1)
        and (${table.lastRetryResultHash} is null
          or ${table.lastRetryResultHash} ~ '^sha256:[0-9a-f]{64}$')
        and (${table.lastRetryErrorCode} is null
          or char_length(${table.lastRetryErrorCode}) between 3 and 256)
        and (${table.terminalResultHash} is null
          or ${table.terminalResultHash} ~ '^sha256:[0-9a-f]{64}$')
        and (${table.terminalErrorCode} is null
          or char_length(${table.terminalErrorCode}) between 3 and 256)
        and (${table.legacyTerminalResultReference} is null
          or public.inbox_v2_auth_payload_reference_safe(
            ${table.legacyTerminalResultReference}, ${table.tenantId}
          ))`
    ),
    check(
      "inbox_v2_outbox_work_items_state_check",
      sql`(${table.state} = 'pending'
          and ${table.availableAt} is not null
          and ${table.leaseOwnerId} is null
          and ${table.leaseTokenHash} is null
          and ${table.leaseRevision} is null
          and ${table.leaseClaimedAt} is null
          and ${table.leaseExpiresAt} is null
          and ${table.terminalResultHash} is null
          and ${table.terminalErrorCode} is null
          and ${table.legacyTerminalResultReference} is null
          and ${table.terminalFinalizedAt} is null)
        or (${table.state} = 'leased'
          and ${table.availableAt} is not null
          and ${table.leaseOwnerId} is not null
          and ${table.leaseTokenHash} is not null
          and ${table.leaseRevision} is not null
          and ${table.leaseClaimedAt} is not null
          and ${table.leaseExpiresAt} is not null
          and ${table.terminalResultHash} is null
          and ${table.terminalErrorCode} is null
          and ${table.legacyTerminalResultReference} is null
          and ${table.terminalFinalizedAt} is null)
        or (${table.state} = 'processed'
          and ${table.availableAt} is null
          and ${table.leaseOwnerId} is null
          and ${table.leaseTokenHash} is null
          and ${table.leaseRevision} is null
          and ${table.leaseClaimedAt} is null
          and ${table.leaseExpiresAt} is null
          and ${table.terminalResultHash} is not null
          and ${table.terminalErrorCode} is null
          and ${table.terminalFinalizedAt} is not null)
        or (${table.state} = 'dead'
          and ${table.availableAt} is null
          and ${table.leaseOwnerId} is null
          and ${table.leaseTokenHash} is null
          and ${table.leaseRevision} is null
          and ${table.leaseClaimedAt} is null
          and ${table.leaseExpiresAt} is null
          and ${table.terminalResultHash} is not null
          and ${table.terminalErrorCode} is not null
          and ${table.terminalFinalizedAt} is not null)`
    ),
    check(
      "inbox_v2_outbox_work_items_retry_check",
      sql`(
          ${table.lastRetryResultHash} is null
          and ${table.lastRetryErrorCode} is null
          and ${table.lastRetryAvailableAt} is null
          and ${table.lastRetryRecordedAt} is null
        ) or (
          ${table.lastRetryResultHash} is not null
          and ${table.lastRetryErrorCode} is not null
          and ${table.lastRetryAvailableAt} is not null
          and ${table.lastRetryRecordedAt} is not null
          and ${table.availableAt} = ${table.lastRetryAvailableAt}
        )`
    ),
    check(
      "inbox_v2_outbox_work_items_times_check",
      sql`isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and ${table.updatedAt} >= ${table.createdAt}
        and (${table.availableAt} is null or isfinite(${table.availableAt}))
        and (${table.leaseClaimedAt} is null or (
          isfinite(${table.leaseClaimedAt})
          and ${table.leaseClaimedAt} between ${table.createdAt} and ${table.updatedAt}
        ))
        and (${table.leaseExpiresAt} is null or (
          isfinite(${table.leaseExpiresAt})
          and ${table.leaseExpiresAt} > ${table.leaseClaimedAt}
        ))
        and (${table.lastRetryAvailableAt} is null or (
          isfinite(${table.lastRetryAvailableAt})
          and ${table.lastRetryAvailableAt} > ${table.lastRetryRecordedAt}
        ))
        and (${table.lastRetryRecordedAt} is null or (
          isfinite(${table.lastRetryRecordedAt})
          and ${table.lastRetryRecordedAt} between ${table.createdAt} and ${table.updatedAt}
        ))
        and (${table.terminalFinalizedAt} is null or (
          isfinite(${table.terminalFinalizedAt})
          and ${table.terminalFinalizedAt} between ${table.createdAt} and ${table.updatedAt}
        ))`
    ),
    index("inbox_v2_outbox_work_items_due_idx")
      .on(table.tenantId, table.availableAt, table.intentId)
      .where(sql`${table.state} = 'pending'`),
    index("inbox_v2_outbox_work_items_reclaim_idx")
      .on(table.tenantId, table.leaseExpiresAt, table.intentId)
      .where(sql`${table.state} = 'leased'`),
    index("inbox_v2_outbox_work_items_dead_idx")
      .on(table.tenantId, table.terminalFinalizedAt.desc(), table.intentId)
      .where(sql`${table.state} = 'dead'`)
  ]
);

/** Immutable record of every retry or terminal outbox decision. */
export const inboxV2OutboxOutcomes = pgTable(
  "inbox_v2_outbox_outcomes",
  {
    tenantId: text("tenant_id").notNull(),
    intentId: text("intent_id").notNull(),
    outcomeRevision: bigint("outcome_revision", { mode: "bigint" }).notNull(),
    kind: inboxV2OutboxOutcomeKind("kind").notNull(),
    leaseTokenHash: text("lease_token_hash").notNull(),
    workerId: text("worker_id").notNull(),
    errorCode: text("error_code"),
    legacyResultReference:
      jsonb("result_reference").$type<Readonly<Record<string, unknown>>>(),
    payloadReferenceRecorded: boolean("payload_reference_recorded")
      .notNull()
      .default(false),
    retryAt: timestamp("retry_at", {
      withTimezone: true,
      precision: 3
    }),
    outcomeHash: text("outcome_hash").notNull(),
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
      name: "inbox_v2_outbox_outcomes_pk",
      columns: [table.tenantId, table.intentId, table.outcomeRevision]
    }),
    unique("inbox_v2_outbox_outcomes_lease_unique").on(
      table.tenantId,
      table.intentId,
      table.leaseTokenHash
    ),
    foreignKey({
      name: "inbox_v2_outbox_outcomes_work_item_fk",
      columns: [table.tenantId, table.intentId],
      foreignColumns: [
        inboxV2OutboxWorkItems.tenantId,
        inboxV2OutboxWorkItems.intentId
      ]
    }).onDelete("cascade"),
    check(
      "inbox_v2_outbox_outcomes_values_check",
      sql`${table.outcomeRevision} >= 1
        and ${table.leaseTokenHash} ~ '^sha256:[0-9a-f]{64}$'
        and char_length(${table.workerId}) between 1 and 256
        and (${table.errorCode} is null
          or char_length(${table.errorCode}) between 3 and 256)
        and ${table.legacyResultReference} is null
        and ${table.outcomeHash} ~ '^sha256:[0-9a-f]{64}$'
        and ((${table.kind} = 'processed'
            and ${table.errorCode} is null
            and ${table.retryAt} is null)
          or (${table.kind} = 'retry'
            and ${table.errorCode} is not null
            and ${table.retryAt} is not null
            and not ${table.payloadReferenceRecorded})
          or (${table.kind} = 'dead'
            and ${table.errorCode} is not null
            and ${table.retryAt} is null))`
    ),
    check(
      "inbox_v2_outbox_outcomes_times_check",
      sql`isfinite(${table.occurredAt})
        and ${table.createdAt} = ${table.occurredAt}
        and (${table.retryAt} is null
          or (isfinite(${table.retryAt}) and ${table.retryAt} > ${table.occurredAt}))`
    ),
    index("inbox_v2_outbox_outcomes_history_idx").on(
      table.tenantId,
      table.intentId,
      table.occurredAt,
      table.outcomeRevision
    )
  ]
);

/**
 * Immutable audit of checkpoint-safe positions whose replay children were
 * removed. The minimized commit/dedupe skeleton has an independent lifecycle.
 */
export const inboxV2TenantStreamRetentionAdvances = pgTable(
  "inbox_v2_tenant_stream_retention_advances",
  {
    tenantId: text("tenant_id").notNull(),
    streamEpoch: text("stream_epoch").notNull(),
    fromPosition: bigint("from_position", { mode: "bigint" }).notNull(),
    toPosition: bigint("to_position", { mode: "bigint" }).notNull(),
    expectedHeadRevision: bigint("expected_head_revision", {
      mode: "bigint"
    }).notNull(),
    resultingHeadRevision: bigint("resulting_head_revision", {
      mode: "bigint"
    }).notNull(),
    mandatoryCheckpointFloor: bigint("mandatory_checkpoint_floor", {
      mode: "bigint"
    }).notNull(),
    prunedCommitCount: bigint("pruned_commit_count", {
      mode: "bigint"
    }).notNull(),
    reasonId: text("reason_id").notNull(),
    advanceHash: text("advance_hash").notNull(),
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
      name: "inbox_v2_tenant_stream_retention_advances_pk",
      columns: [table.tenantId, table.streamEpoch, table.toPosition]
    }),
    foreignKey({
      name: "inbox_v2_tenant_stream_retention_advances_head_fk",
      columns: [table.tenantId],
      foreignColumns: [inboxV2TenantStreamHeads.tenantId]
    }).onDelete("cascade"),
    check(
      "inbox_v2_tenant_stream_retention_values_check",
      sql`${table.fromPosition} >= 0
        and ${table.toPosition} > ${table.fromPosition}
        and ${table.toPosition} <= ${table.mandatoryCheckpointFloor}
        and ${table.expectedHeadRevision} >= 1
        and ${table.resultingHeadRevision} = ${table.expectedHeadRevision} + 1
        and ${table.prunedCommitCount} =
          ${table.toPosition} - greatest(${table.fromPosition}, 1)
        and char_length(${table.reasonId}) between 3 and 256
        and ${table.advanceHash} ~ '^sha256:[0-9a-f]{64}$'
        and char_length(${table.streamEpoch}) between 8 and 256`
    ),
    check(
      "inbox_v2_tenant_stream_retention_times_check",
      sql`isfinite(${table.occurredAt})
        and ${table.createdAt} = ${table.occurredAt}`
    ),
    index("inbox_v2_tenant_stream_retention_history_idx").on(
      table.tenantId,
      table.occurredAt,
      table.toPosition
    )
  ]
);

/**
 * Trigger invariants are finalized into the migration from this authoritative
 * block. Repositories still use CAS predicates; these guards prevent direct
 * SQL from manufacturing a non-contiguous projection or unfenced outbox state.
 */
export const INBOX_V2_REPOSITORY_FOUNDATION_INTEGRITY_SQL = String.raw`
do $retention_role_bootstrap$
begin
  if not exists (
    select 1 from pg_catalog.pg_roles
     where rolname = 'hulee_inbox_v2_retention_owner'
  ) then
    create role hulee_inbox_v2_retention_owner
      nologin nosuperuser nocreatedb nocreaterole
      inherit noreplication nobypassrls;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_roles
     where rolname = 'hulee_inbox_v2_runtime'
  ) then
    create role hulee_inbox_v2_runtime
      nologin nosuperuser nocreatedb nocreaterole
      inherit noreplication nobypassrls;
  end if;

  if pg_catalog.pg_has_role(
    'hulee_inbox_v2_runtime',
    'hulee_inbox_v2_retention_owner',
    'MEMBER'
  ) then
    raise exception using
      errcode = '42501',
      message = 'inbox_v2.retention_owner_role_must_not_be_inherited';
  end if;
end;
$retention_role_bootstrap$;

alter role hulee_inbox_v2_retention_owner
  with nologin nosuperuser nocreatedb nocreaterole
       inherit noreplication nobypassrls;

revoke create on schema public
  from hulee_inbox_v2_retention_owner,
       hulee_inbox_v2_runtime;
grant usage on schema public
  to hulee_inbox_v2_retention_owner,
     hulee_inbox_v2_runtime;

create or replace function public.inbox_v2_auth_reject_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'DELETE' then
    if not exists (
      select 1 from public.tenants tenant_row where tenant_row.id = old.tenant_id
    ) then
      return old;
    end if;
    if current_user = 'hulee_inbox_v2_retention_owner'
       and pg_catalog.current_setting(
         'hulee.inbox_v2_retention_prune', true
       ) = 'enabled'
       and tg_table_name in (
         'inbox_v2_tenant_stream_changes',
         'inbox_v2_domain_events',
         'inbox_v2_outbox_intents'
       ) then
      return old;
    end if;
  end if;
  raise exception using
    errcode = '23514',
    message = format('inbox_v2.authorization_immutable:%s:%s', tg_table_name, tg_op);
end;
$function$;

create or replace function public.inbox_v2_auth_stream_head_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'DELETE' then
    if not exists (
      select 1 from public.tenants tenant_row where tenant_row.id = old.tenant_id
    ) then return old; end if;
    raise exception using errcode = '23514',
      message = 'inbox_v2.tenant_stream_head_delete_forbidden';
  end if;
  if tg_op = 'INSERT' then
    if new.last_position <> 0 or new.min_retained_position <> 0
       or new.revision <> 1 or new.updated_at <> new.created_at then
      raise exception using errcode = '23514',
        message = 'inbox_v2.tenant_stream_head_initial_state_invalid';
    end if;
  elsif new.tenant_id is distinct from old.tenant_id
     or new.stream_epoch is distinct from old.stream_epoch
     or new.created_at is distinct from old.created_at
     or new.revision <> old.revision + 1
     or new.updated_at < old.updated_at
     or not (
       (
         new.last_position = old.last_position + 1
         and new.min_retained_position = old.min_retained_position
       ) or (
         new.last_position = old.last_position
         and new.min_retained_position > old.min_retained_position
         and new.min_retained_position <= new.last_position
         and current_user = 'hulee_inbox_v2_retention_owner'
         and pg_catalog.current_setting(
           'hulee.inbox_v2_retention_prune', true
         ) = 'enabled'
       )
     ) then
    raise exception using errcode = '40001',
      message = 'inbox_v2.tenant_stream_head_cas_conflict';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_repository_projection_checkpoint_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'INSERT' then
    if new.revision <> 1 or new.updated_at <> new.created_at then
      raise exception using errcode = '23514',
        message = 'inbox_v2.projection_checkpoint_initial_state_invalid';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if new.tenant_id is distinct from old.tenant_id
     or new.projection_id is distinct from old.projection_id
     or new.scope_id is distinct from old.scope_id
     or new.generation is distinct from old.generation
     or new.stream_epoch is distinct from old.stream_epoch
     or new.created_at is distinct from old.created_at
     or new.position <> old.position + 1
     or new.last_commit_id is null
     or new.revision <> old.revision + 1
     or new.updated_at < old.updated_at then
    raise exception using errcode = '40001',
      message = 'inbox_v2.projection_checkpoint_gap';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_repository_projection_head_coherence()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_tenant_id text := coalesce(to_jsonb(new)->>'tenant_id', to_jsonb(old)->>'tenant_id');
  v_projection_id text := coalesce(to_jsonb(new)->>'projection_id', to_jsonb(old)->>'projection_id');
  v_scope_id text := coalesce(to_jsonb(new)->>'scope_id', to_jsonb(old)->>'scope_id');
begin
  if exists (
    select 1
      from public.inbox_v2_projection_generations generation_row
     where generation_row.tenant_id = v_tenant_id
       and generation_row.projection_id = v_projection_id
       and generation_row.scope_id = v_scope_id
       and not exists (
         select 1
           from public.inbox_v2_projection_checkpoints checkpoint_row
          where checkpoint_row.tenant_id = generation_row.tenant_id
            and checkpoint_row.projection_id = generation_row.projection_id
            and checkpoint_row.scope_id = generation_row.scope_id
            and checkpoint_row.generation = generation_row.generation
            and checkpoint_row.stream_epoch = generation_row.stream_epoch
       )
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.projection_generation_checkpoint_missing';
  end if;

  if (
    exists (
      select 1
        from public.inbox_v2_projection_heads head_row
       where head_row.tenant_id = v_tenant_id
         and head_row.projection_id = v_projection_id
         and head_row.scope_id = v_scope_id
    ) or exists (
      select 1
        from public.inbox_v2_projection_generations generation_row
       where generation_row.tenant_id = v_tenant_id
         and generation_row.projection_id = v_projection_id
         and generation_row.scope_id = v_scope_id
         and generation_row.state = 'active'
    )
  ) and not exists (
    select 1
      from public.inbox_v2_projection_heads head_row
      join public.inbox_v2_projection_generations generation_row
        on generation_row.tenant_id = head_row.tenant_id
       and generation_row.projection_id = head_row.projection_id
       and generation_row.scope_id = head_row.scope_id
       and generation_row.generation = head_row.current_generation
       and generation_row.stream_epoch = head_row.stream_epoch
       and generation_row.projection_schema_version =
           head_row.projection_schema_version
       and generation_row.state = 'active'
     where head_row.tenant_id = v_tenant_id
       and head_row.projection_id = v_projection_id
       and head_row.scope_id = v_scope_id
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.projection_head_generation_incoherent';
  end if;
  return null;
end;
$function$;

create or replace function public.inbox_v2_advance_tenant_stream_retained_prefix_v1(
  checked_tenant_id text,
  checked_stream_epoch text,
  checked_from_position bigint,
  checked_to_position bigint,
  checked_expected_head_revision bigint,
  checked_mandatory_checkpoint_floor bigint,
  checked_reason_id text,
  checked_advance_hash text,
  checked_changed_at timestamptz
)
returns table (
  tenant_id text,
  stream_epoch text,
  last_position bigint,
  min_retained_position bigint,
  revision bigint,
  created_at timestamptz,
  updated_at timestamptz,
  pruned_commit_count bigint,
  to_position bigint
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_db_now timestamptz := pg_catalog.clock_timestamp();
  v_head public.inbox_v2_tenant_stream_heads%rowtype;
  v_persisted_checkpoint_floor bigint;
  v_expected_commit_count bigint;
  v_commit_count bigint;
  v_expected_change_count bigint;
  v_expected_event_count bigint;
  v_expected_intent_count bigint;
  v_expected_work_count bigint;
  v_expected_outcome_count bigint;
  v_deleted_change_count bigint;
  v_deleted_event_count bigint;
  v_deleted_intent_count bigint;
  v_deleted_work_count bigint;
  v_deleted_outcome_count bigint;
begin
  if checked_tenant_id is null
     or checked_stream_epoch is null
     or checked_from_position is null
     or checked_to_position is null
     or checked_expected_head_revision is null
     or checked_mandatory_checkpoint_floor is null
     or checked_reason_id is null
     or checked_advance_hash is null
     or checked_changed_at is null
     or checked_from_position < 0
     or checked_to_position <= checked_from_position
     or checked_expected_head_revision < 1
     or checked_mandatory_checkpoint_floor < checked_to_position
     or not pg_catalog.isfinite(checked_changed_at)
     or pg_catalog.length(checked_stream_epoch) not between 8 and 256
     or pg_catalog.length(checked_reason_id) not between 3 and 256
     or pg_catalog.strpos(checked_reason_id, ':') = 0
     or checked_advance_hash !~ '^sha256:[0-9a-f]{64}$' then
    raise exception using
      errcode = '22023',
      message = 'inbox_v2.retained_prefix_arguments_invalid';
  end if;

  if checked_changed_at > v_db_now then
    raise exception using
      errcode = '22023',
      message = 'inbox_v2.retained_prefix_changed_at_future';
  end if;

  if checked_changed_at < v_db_now - interval '1 minute' then
    raise exception using
      errcode = '22023',
      message = 'inbox_v2.retained_prefix_changed_at_stale';
  end if;

  select head_row.*
    into v_head
    from public.inbox_v2_tenant_stream_heads head_row
   where head_row.tenant_id = checked_tenant_id
   for update;

  if not found or v_head.stream_epoch <> checked_stream_epoch then
    raise exception using
      errcode = 'P0002',
      message = 'inbox_v2.tenant_stream_not_found';
  end if;
  if v_head.min_retained_position <> checked_from_position
     or v_head.revision <> checked_expected_head_revision then
    raise exception using
      errcode = '40001',
      message = 'inbox_v2.retained_prefix_cas_conflict';
  end if;
  if checked_to_position > v_head.last_position
     or checked_changed_at < v_head.updated_at then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.retained_prefix_head_boundary_invalid';
  end if;

  select min(checkpoint_row.position)
    into v_persisted_checkpoint_floor
    from public.inbox_v2_projection_generations generation_row
    join public.inbox_v2_projection_checkpoints checkpoint_row
      on checkpoint_row.tenant_id = generation_row.tenant_id
     and checkpoint_row.projection_id = generation_row.projection_id
     and checkpoint_row.scope_id = generation_row.scope_id
     and checkpoint_row.generation = generation_row.generation
     and checkpoint_row.stream_epoch = generation_row.stream_epoch
   where generation_row.tenant_id = checked_tenant_id
     and generation_row.stream_epoch = checked_stream_epoch
     and generation_row.state in ('active', 'shadow');

  if v_persisted_checkpoint_floor is null
     or checked_mandatory_checkpoint_floor > v_persisted_checkpoint_floor
     or checked_to_position > checked_mandatory_checkpoint_floor then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.retained_prefix_checkpoint_blocked';
  end if;

  v_expected_commit_count :=
    checked_to_position - greatest(checked_from_position, 1);
  select count(*),
         coalesce(sum(commit_row.change_count), 0),
         coalesce(sum(commit_row.event_count), 0),
         coalesce(sum(commit_row.outbox_intent_count), 0)
    into v_commit_count,
         v_expected_change_count,
         v_expected_event_count,
         v_expected_intent_count
    from public.inbox_v2_tenant_stream_commits commit_row
   where commit_row.tenant_id = checked_tenant_id
     and commit_row.stream_epoch = checked_stream_epoch
     and commit_row.position >= greatest(checked_from_position, 1)
     and commit_row.position < checked_to_position;

  if v_commit_count <> v_expected_commit_count then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.retained_prefix_commit_gap';
  end if;

  if exists (
    select 1
      from public.inbox_v2_outbox_intents intent_row
      join public.inbox_v2_outbox_work_items work_row
        on work_row.tenant_id = intent_row.tenant_id
       and work_row.intent_id = intent_row.id
     where intent_row.tenant_id = checked_tenant_id
       and intent_row.stream_position >=
           greatest(checked_from_position, 1)
       and intent_row.stream_position < checked_to_position
       and work_row.state in ('pending', 'leased')
  ) then
    raise exception using
      errcode = '55000',
      message = 'inbox_v2.retained_prefix_outbox_inflight';
  end if;

  select count(*)
    into v_expected_work_count
    from public.inbox_v2_outbox_work_items work_row
    join public.inbox_v2_outbox_intents intent_row
      on intent_row.tenant_id = work_row.tenant_id
     and intent_row.id = work_row.intent_id
   where intent_row.tenant_id = checked_tenant_id
     and intent_row.stream_position >=
         greatest(checked_from_position, 1)
     and intent_row.stream_position < checked_to_position;

  if v_expected_work_count <> v_expected_intent_count then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.retained_prefix_manifest_incoherent';
  end if;

  select count(*)
    into v_expected_outcome_count
    from public.inbox_v2_outbox_outcomes outcome_row
    join public.inbox_v2_outbox_intents intent_row
      on intent_row.tenant_id = outcome_row.tenant_id
     and intent_row.id = outcome_row.intent_id
   where intent_row.tenant_id = checked_tenant_id
     and intent_row.stream_position >=
         greatest(checked_from_position, 1)
     and intent_row.stream_position < checked_to_position;

  perform pg_catalog.set_config(
    'hulee.inbox_v2_retention_prune',
    'enabled',
    true
  );

  delete from public.inbox_v2_outbox_outcomes outcome_row
  using public.inbox_v2_outbox_intents intent_row
   where intent_row.tenant_id = checked_tenant_id
     and intent_row.stream_position >=
         greatest(checked_from_position, 1)
     and intent_row.stream_position < checked_to_position
     and outcome_row.tenant_id = intent_row.tenant_id
     and outcome_row.intent_id = intent_row.id;
  get diagnostics v_deleted_outcome_count = row_count;

  delete from public.inbox_v2_outbox_work_items work_row
  using public.inbox_v2_outbox_intents intent_row
   where intent_row.tenant_id = checked_tenant_id
     and intent_row.stream_position >=
         greatest(checked_from_position, 1)
     and intent_row.stream_position < checked_to_position
     and work_row.tenant_id = intent_row.tenant_id
     and work_row.intent_id = intent_row.id;
  get diagnostics v_deleted_work_count = row_count;

  delete from public.inbox_v2_outbox_intents intent_row
   where intent_row.tenant_id = checked_tenant_id
     and intent_row.stream_position >=
         greatest(checked_from_position, 1)
     and intent_row.stream_position < checked_to_position;
  get diagnostics v_deleted_intent_count = row_count;

  delete from public.inbox_v2_domain_events event_row
   where event_row.tenant_id = checked_tenant_id
     and event_row.stream_position >=
         greatest(checked_from_position, 1)
     and event_row.stream_position < checked_to_position;
  get diagnostics v_deleted_event_count = row_count;

  delete from public.inbox_v2_tenant_stream_changes change_row
   where change_row.tenant_id = checked_tenant_id
     and change_row.stream_position >=
         greatest(checked_from_position, 1)
     and change_row.stream_position < checked_to_position;
  get diagnostics v_deleted_change_count = row_count;

  if v_deleted_change_count <> v_expected_change_count
     or v_deleted_event_count <> v_expected_event_count
     or v_deleted_intent_count <> v_expected_intent_count
     or v_deleted_work_count <> v_expected_work_count
     or v_deleted_outcome_count <> v_expected_outcome_count then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.retained_prefix_manifest_incoherent';
  end if;

  update public.inbox_v2_tenant_stream_heads head_row
     set min_retained_position = checked_to_position,
         revision = head_row.revision + 1,
         updated_at = checked_changed_at
   where head_row.tenant_id = checked_tenant_id
     and head_row.stream_epoch = checked_stream_epoch
     and head_row.min_retained_position = checked_from_position
     and head_row.revision = checked_expected_head_revision
  returning head_row.* into v_head;
  if not found then
    raise exception using
      errcode = '40001',
      message = 'inbox_v2.retained_prefix_cas_conflict';
  end if;

  insert into public.inbox_v2_tenant_stream_retention_advances (
    tenant_id, stream_epoch, from_position, to_position,
    expected_head_revision, resulting_head_revision,
    mandatory_checkpoint_floor, pruned_commit_count, reason_id,
    advance_hash, occurred_at, created_at
  ) values (
    checked_tenant_id,
    checked_stream_epoch,
    checked_from_position,
    checked_to_position,
    checked_expected_head_revision,
    v_head.revision,
    checked_mandatory_checkpoint_floor,
    v_commit_count,
    checked_reason_id,
    checked_advance_hash,
    checked_changed_at,
    checked_changed_at
  );

  perform pg_catalog.set_config(
    'hulee.inbox_v2_retention_prune',
    'disabled',
    true
  );

  return query select
    v_head.tenant_id,
    v_head.stream_epoch,
    v_head.last_position,
    v_head.min_retained_position,
    v_head.revision,
    v_head.created_at,
    v_head.updated_at,
    v_commit_count,
    checked_to_position;
end;
$function$;

create or replace function public.inbox_v2_repository_outbox_intent_work_init()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  insert into public.inbox_v2_outbox_work_items (
    tenant_id, intent_id, state, attempt_count, available_at,
    revision, created_at, updated_at
  ) values (
    new.tenant_id, new.id, 'pending', 0, new.available_at, 1,
    new.created_at, new.created_at
  );
  return new;
end;
$function$;

create or replace function public.inbox_v2_repository_outbox_work_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'INSERT' then
    if new.state <> 'pending' or new.attempt_count <> 0
       or new.revision <> 1
       or new.updated_at <> new.created_at then
      raise exception using errcode = '23514',
        message = 'inbox_v2.outbox_work_initial_state_invalid';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if new.tenant_id is distinct from old.tenant_id
     or new.intent_id is distinct from old.intent_id
     or new.created_at is distinct from old.created_at
     or new.revision <> old.revision + 1
     or new.updated_at < old.updated_at then
    raise exception using errcode = '23514',
      message = 'inbox_v2.outbox_work_identity_invalid';
  end if;
  if new.state = 'leased' then
    if old.state = 'pending' then
      if new.attempt_count <> old.attempt_count + 1
         or new.lease_revision <> 1
         or new.lease_claimed_at <> new.updated_at then
        raise exception using errcode = '40001',
          message = 'inbox_v2.outbox_claim_conflict';
      end if;
    elsif old.state = 'leased' then
      if old.lease_expires_at <= new.updated_at then
        if new.attempt_count <> old.attempt_count + 1
           or new.lease_token_hash is not distinct from old.lease_token_hash
           or new.lease_revision <> old.lease_revision + 1
           or new.lease_claimed_at <> new.updated_at then
          raise exception using errcode = '40001',
            message = 'inbox_v2.outbox_reclaim_conflict';
        end if;
      elsif new.attempt_count <> old.attempt_count
         or new.lease_token_hash is distinct from old.lease_token_hash
         or new.lease_owner_id is distinct from old.lease_owner_id
         or new.lease_revision <> old.lease_revision + 1
         or new.lease_claimed_at is distinct from old.lease_claimed_at
         or new.lease_expires_at < old.lease_expires_at
      then
        raise exception using errcode = '40001',
          message = 'inbox_v2.outbox_renew_conflict';
      end if;
    else
      raise exception using errcode = '23514',
        message = 'inbox_v2.outbox_terminal_state_immutable';
    end if;
  elsif new.state in ('pending', 'processed', 'dead') then
    if old.state <> 'leased'
       or old.lease_expires_at <= new.updated_at
       or new.attempt_count <> old.attempt_count then
      raise exception using errcode = '40001',
        message = 'inbox_v2.outbox_finalize_conflict';
    end if;
  else
    raise exception using errcode = '23514',
      message = 'inbox_v2.outbox_state_transition_invalid';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_repository_outbox_finalize_coherence()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_expected_kind public.inbox_v2_outbox_outcome_kind;
begin
  if old.state = 'leased' and new.state <> 'leased' then
    v_expected_kind := case new.state
      when 'pending' then 'retry'::public.inbox_v2_outbox_outcome_kind
      when 'processed' then 'processed'::public.inbox_v2_outbox_outcome_kind
      when 'dead' then 'dead'::public.inbox_v2_outbox_outcome_kind
    end;
    if not exists (
      select 1
        from public.inbox_v2_outbox_outcomes outcome_row
       where outcome_row.tenant_id = new.tenant_id
         and outcome_row.intent_id = new.intent_id
         and outcome_row.outcome_revision = new.revision
         and outcome_row.kind = v_expected_kind
         and outcome_row.lease_token_hash = old.lease_token_hash
         and outcome_row.occurred_at = new.updated_at
    ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.outbox_finalize_outcome_missing';
    end if;
  end if;
  return null;
end;
$function$;

create or replace function public.inbox_v2_repository_outbox_outcome_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'DELETE' then
    if not exists (
      select 1 from public.tenants tenant_row where tenant_row.id = old.tenant_id
    ) then
      return old;
    end if;
    if current_user = 'hulee_inbox_v2_retention_owner'
       and pg_catalog.current_setting(
         'hulee.inbox_v2_retention_prune', true
       ) = 'enabled' then
      return old;
    end if;
  end if;
  raise exception using errcode = '23514',
    message = 'inbox_v2.outbox_outcome_immutable';
end;
$function$;

create or replace function public.inbox_v2_repository_retention_advance_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'DELETE' and not exists (
    select 1 from public.tenants tenant_row where tenant_row.id = old.tenant_id
  ) then
    return old;
  end if;
  raise exception using errcode = '23514',
    message = 'inbox_v2.tenant_stream_retention_advance_immutable';
end;
$function$;

grant select on table
  public.tenants,
  public.inbox_v2_tenant_stream_heads,
  public.inbox_v2_tenant_stream_commits,
  public.inbox_v2_tenant_stream_changes,
  public.inbox_v2_domain_events,
  public.inbox_v2_outbox_intents,
  public.inbox_v2_projection_generations,
  public.inbox_v2_projection_checkpoints,
  public.inbox_v2_outbox_work_items,
  public.inbox_v2_outbox_outcomes
to hulee_inbox_v2_retention_owner;

grant update on table
  public.inbox_v2_tenant_stream_heads
to hulee_inbox_v2_retention_owner;

grant delete on table
  public.inbox_v2_tenant_stream_changes,
  public.inbox_v2_domain_events,
  public.inbox_v2_outbox_intents,
  public.inbox_v2_outbox_work_items,
  public.inbox_v2_outbox_outcomes
to hulee_inbox_v2_retention_owner;

grant insert on table
  public.inbox_v2_tenant_stream_retention_advances
to hulee_inbox_v2_retention_owner;

grant create on schema public to hulee_inbox_v2_retention_owner;
alter function public.inbox_v2_advance_tenant_stream_retained_prefix_v1(
  text,
  text,
  bigint,
  bigint,
  bigint,
  bigint,
  text,
  text,
  timestamptz
) owner to hulee_inbox_v2_retention_owner;
revoke create on schema public from hulee_inbox_v2_retention_owner;

revoke all privileges on function
  public.inbox_v2_advance_tenant_stream_retained_prefix_v1(
    text,
    text,
    bigint,
    bigint,
    bigint,
    bigint,
    text,
    text,
    timestamptz
  )
from public;

grant execute on function
  public.inbox_v2_advance_tenant_stream_retained_prefix_v1(
    text,
    text,
    bigint,
    bigint,
    bigint,
    bigint,
    text,
    text,
    timestamptz
  )
to hulee_inbox_v2_runtime;

revoke delete, truncate on table
  public.inbox_v2_tenant_stream_commits,
  public.inbox_v2_tenant_stream_changes,
  public.inbox_v2_domain_events,
  public.inbox_v2_outbox_intents,
  public.inbox_v2_outbox_work_items,
  public.inbox_v2_outbox_outcomes,
  public.inbox_v2_tenant_stream_retention_advances
from public,
     hulee_inbox_v2_runtime;

do $retention_boundary_audit$
declare
  v_function_oid oid := pg_catalog.to_regprocedure(
    'public.inbox_v2_advance_tenant_stream_retained_prefix_v1(text,text,bigint,bigint,bigint,bigint,text,text,timestamp with time zone)'
  );
begin
  if not exists (
    select 1
      from pg_catalog.pg_roles role_row
     where role_row.rolname = 'hulee_inbox_v2_retention_owner'
       and not role_row.rolcanlogin
       and not role_row.rolsuper
       and not role_row.rolcreatedb
       and not role_row.rolcreaterole
       and not role_row.rolreplication
       and not role_row.rolbypassrls
  ) or pg_catalog.pg_has_role(
    'hulee_inbox_v2_runtime',
    'hulee_inbox_v2_retention_owner',
    'MEMBER'
  ) then
    raise exception using
      errcode = '42501',
      message = 'inbox_v2.retention_database_role_unsafe';
  end if;

  if v_function_oid is null or not exists (
    select 1
      from pg_catalog.pg_proc procedure_row
      join pg_catalog.pg_roles owner_role
        on owner_role.oid = procedure_row.proowner
     where procedure_row.oid = v_function_oid
       and procedure_row.prosecdef
       and owner_role.rolname = 'hulee_inbox_v2_retention_owner'
       and procedure_row.proconfig @>
         array['search_path=pg_catalog, public, pg_temp']::text[]
       and procedure_row.prosrc like
         '%delete from public.inbox_v2_outbox_outcomes%'
       and procedure_row.prosrc like
         '%delete from public.inbox_v2_outbox_work_items%'
       and procedure_row.prosrc like
         '%delete from public.inbox_v2_outbox_intents%'
       and procedure_row.prosrc like
         '%delete from public.inbox_v2_domain_events%'
       and procedure_row.prosrc like
         '%delete from public.inbox_v2_tenant_stream_changes%'
       and procedure_row.prosrc not like
         '%delete from public.inbox_v2_tenant_stream_commits%'
       and procedure_row.prosrc like
         '%v_db_now timestamptz := pg_catalog.clock_timestamp()%'
       and procedure_row.prosrc like
         '%inbox_v2.retained_prefix_changed_at_future%'
       and procedure_row.prosrc like
         '%inbox_v2.retained_prefix_changed_at_stale%'
       and procedure_row.prosrc like
         '%update public.inbox_v2_tenant_stream_heads%'
       and procedure_row.prosrc like
         '%updated_at = checked_changed_at%'
       and procedure_row.prosrc like
         '%insert into public.inbox_v2_tenant_stream_retention_advances%'
  ) then
    raise exception using
      errcode = '42501',
      message = 'inbox_v2.retention_entrypoint_definition_invalid';
  end if;

  if exists (
    select 1
      from pg_catalog.pg_proc procedure_row
      cross join lateral pg_catalog.aclexplode(
        coalesce(
          procedure_row.proacl,
          pg_catalog.acldefault('f', procedure_row.proowner)
        )
      ) privilege_row
     where procedure_row.oid = v_function_oid
       and privilege_row.grantee = 0
       and privilege_row.privilege_type = 'EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    'hulee_inbox_v2_runtime',
    v_function_oid,
    'EXECUTE'
  ) then
    raise exception using
      errcode = '42501',
      message = 'inbox_v2.retention_entrypoint_acl_invalid';
  end if;

  if exists (
    select 1
      from (
        values
          ('public.inbox_v2_tenant_stream_commits'),
          ('public.inbox_v2_tenant_stream_changes'),
          ('public.inbox_v2_domain_events'),
          ('public.inbox_v2_outbox_intents'),
          ('public.inbox_v2_outbox_work_items'),
          ('public.inbox_v2_outbox_outcomes'),
          ('public.inbox_v2_tenant_stream_retention_advances')
      ) as protected_table(table_name)
     where pg_catalog.has_table_privilege(
       'hulee_inbox_v2_runtime',
       protected_table.table_name,
       'DELETE'
     )
  ) or pg_catalog.has_table_privilege(
    'hulee_inbox_v2_retention_owner',
    'public.inbox_v2_tenant_stream_commits',
    'DELETE'
  ) or pg_catalog.has_table_privilege(
    'hulee_inbox_v2_retention_owner',
    'public.inbox_v2_tenant_stream_retention_advances',
    'DELETE'
  ) or not pg_catalog.has_table_privilege(
    'hulee_inbox_v2_retention_owner',
    'public.inbox_v2_outbox_work_items',
    'SELECT,DELETE'
  ) or not pg_catalog.has_table_privilege(
    'hulee_inbox_v2_retention_owner',
    'public.inbox_v2_outbox_outcomes',
    'SELECT,DELETE'
  ) then
    raise exception using
      errcode = '42501',
      message = 'inbox_v2.retention_direct_delete_boundary_invalid';
  end if;
end;
$retention_boundary_audit$;

create trigger inbox_v2_projection_checkpoint_guard_trigger
before insert or update on public.inbox_v2_projection_checkpoints
for each row execute function public.inbox_v2_repository_projection_checkpoint_guard();

create constraint trigger inbox_v2_projection_generation_head_coherence_trigger
after insert or update or delete on public.inbox_v2_projection_generations
deferrable initially deferred
for each row execute function public.inbox_v2_repository_projection_head_coherence();

create constraint trigger inbox_v2_projection_head_generation_coherence_trigger
after insert or update or delete on public.inbox_v2_projection_heads
deferrable initially deferred
for each row execute function public.inbox_v2_repository_projection_head_coherence();

create constraint trigger inbox_v2_projection_checkpoint_generation_coherence_trigger
after insert or update or delete on public.inbox_v2_projection_checkpoints
deferrable initially deferred
for each row execute function public.inbox_v2_repository_projection_head_coherence();

create trigger inbox_v2_outbox_intent_work_init_trigger
after insert on public.inbox_v2_outbox_intents
for each row execute function public.inbox_v2_repository_outbox_intent_work_init();

create trigger inbox_v2_outbox_work_guard_trigger
before insert or update on public.inbox_v2_outbox_work_items
for each row execute function public.inbox_v2_repository_outbox_work_guard();

create constraint trigger inbox_v2_outbox_finalize_coherence_trigger
after update on public.inbox_v2_outbox_work_items
deferrable initially deferred
for each row execute function public.inbox_v2_repository_outbox_finalize_coherence();

create trigger inbox_v2_outbox_outcome_immutable_trigger
before update or delete on public.inbox_v2_outbox_outcomes
for each row execute function public.inbox_v2_repository_outbox_outcome_immutable();

create trigger inbox_v2_tenant_stream_retention_advance_immutable_trigger
before update or delete on public.inbox_v2_tenant_stream_retention_advances
for each row execute function public.inbox_v2_repository_retention_advance_immutable();
`;
