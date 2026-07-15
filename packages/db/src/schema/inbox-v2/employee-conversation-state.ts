import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp
} from "drizzle-orm/pg-core";

import { employees, inboxV2Conversations } from "../tables";

export const inboxV2EmployeeConversationNotificationLevel = pgEnum(
  "inbox_v2_employee_conversation_notification_level",
  ["inherit", "all", "mentions_only", "none"]
);

/**
 * Sparse personal state. Row existence is never an authorization grant and no
 * Employee x Conversation matrix is pre-created.
 */
export const inboxV2EmployeeConversationStates = pgTable(
  "inbox_v2_employee_conversation_states",
  {
    tenantId: text("tenant_id").notNull(),
    employeeId: text("employee_id").notNull(),
    conversationId: text("conversation_id").notNull(),
    lastReadSequence: bigint("last_read_sequence", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    lastReadAt: timestamp("last_read_at", {
      withTimezone: true,
      precision: 3
    }),
    manualUnread: boolean("manual_unread").notNull().default(false),
    manualUnreadChangedAt: timestamp("manual_unread_changed_at", {
      withTimezone: true,
      precision: 3
    })
      .notNull()
      .defaultNow(),
    muted: boolean("muted").notNull().default(false),
    muteChangedAt: timestamp("mute_changed_at", {
      withTimezone: true,
      precision: 3
    })
      .notNull()
      .defaultNow(),
    notificationLevel: inboxV2EmployeeConversationNotificationLevel(
      "notification_level"
    )
      .notNull()
      .default("inherit"),
    notificationLevelChangedAt: timestamp("notification_level_changed_at", {
      withTimezone: true,
      precision: 3
    })
      .notNull()
      .defaultNow(),
    pinned: boolean("pinned").notNull().default(false),
    pinChangedAt: timestamp("pin_changed_at", {
      withTimezone: true,
      precision: 3
    })
      .notNull()
      .defaultNow(),
    archived: boolean("archived").notNull().default(false),
    archiveChangedAt: timestamp("archive_changed_at", {
      withTimezone: true,
      precision: 3
    })
      .notNull()
      .defaultNow(),
    revision: bigint("revision", { mode: "bigint" })
      .notNull()
      .default(sql`1`),
    lastChangedStreamPosition: bigint("last_changed_stream_position", {
      mode: "bigint"
    }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      precision: 3
    })
      .notNull()
      .defaultNow()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_employee_conversation_states_pk",
      columns: [table.tenantId, table.employeeId, table.conversationId]
    }),
    foreignKey({
      name: "inbox_v2_employee_conversation_states_employee_fk",
      columns: [table.tenantId, table.employeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_employee_conversation_states_conversation_fk",
      columns: [table.tenantId, table.conversationId],
      foreignColumns: [inboxV2Conversations.tenantId, inboxV2Conversations.id]
    }).onDelete("cascade"),
    check(
      "inbox_v2_employee_conversation_states_read_check",
      sql`${table.lastReadSequence} >= 0 and (
        (${table.lastReadSequence} = 0 and ${table.lastReadAt} is null)
        or (${table.lastReadSequence} > 0 and ${table.lastReadAt} is not null)
      )`
    ),
    check(
      "inbox_v2_employee_conversation_states_revision_check",
      sql`${table.revision} >= 1 and ${table.lastChangedStreamPosition} >= 1`
    ),
    check(
      "inbox_v2_employee_conversation_states_timestamps_check",
      sql`isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and ${table.updatedAt} >= ${table.createdAt}
        and (${table.lastReadAt} is null or (
          isfinite(${table.lastReadAt})
          and ${table.lastReadAt} between ${table.createdAt} and ${table.updatedAt}
        ))
        and isfinite(${table.manualUnreadChangedAt})
        and ${table.manualUnreadChangedAt} between ${table.createdAt} and ${table.updatedAt}
        and isfinite(${table.muteChangedAt})
        and ${table.muteChangedAt} between ${table.createdAt} and ${table.updatedAt}
        and isfinite(${table.notificationLevelChangedAt})
        and ${table.notificationLevelChangedAt} between ${table.createdAt} and ${table.updatedAt}
        and isfinite(${table.pinChangedAt})
        and ${table.pinChangedAt} between ${table.createdAt} and ${table.updatedAt}
        and isfinite(${table.archiveChangedAt})
        and ${table.archiveChangedAt} between ${table.createdAt} and ${table.updatedAt}`
    ),
    index("inbox_v2_employee_conversation_states_conversation_idx").on(
      table.tenantId,
      table.conversationId,
      table.employeeId
    ),
    index("inbox_v2_employee_conversation_states_sync_idx").on(
      table.tenantId,
      table.employeeId,
      table.lastChangedStreamPosition,
      table.conversationId
    ),
    index("inbox_v2_employee_conversation_states_pinned_idx")
      .on(
        table.tenantId,
        table.employeeId,
        table.pinChangedAt.desc(),
        table.conversationId
      )
      .where(sql`${table.pinned}`),
    index("inbox_v2_employee_conversation_states_archived_idx")
      .on(
        table.tenantId,
        table.employeeId,
        table.archiveChangedAt.desc(),
        table.conversationId
      )
      .where(sql`${table.archived}`)
  ]
);

/**
 * Raw PostgreSQL invariants intentionally live beside the Drizzle table so the
 * finalized migration and schema tests consume one authoritative definition.
 */
export const INBOX_V2_EMPLOYEE_CONVERSATION_STATE_INVARIANTS_SQL = String.raw`
create or replace function public.inbox_v2_ecs_state_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'INSERT' then
    if new.revision <> 1
       or new.updated_at <> new.created_at
       or new.manual_unread_changed_at <> new.created_at
       or new.mute_changed_at <> new.created_at
       or new.notification_level_changed_at <> new.created_at
       or new.pin_changed_at <> new.created_at
       or new.archive_changed_at <> new.created_at
       or (new.last_read_sequence = 0 and new.last_read_at is not null)
       or (new.last_read_sequence > 0 and new.last_read_at <> new.created_at) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.employee_conversation_state_invalid_initial_metadata';
    end if;
    return new;
  end if;

  if new.tenant_id is distinct from old.tenant_id
     or new.employee_id is distinct from old.employee_id
     or new.conversation_id is distinct from old.conversation_id
     or new.created_at is distinct from old.created_at then
    raise exception using errcode = '23514',
      message = 'inbox_v2.employee_conversation_state_identity_immutable';
  end if;

  if new.last_read_sequence < old.last_read_sequence then
    raise exception using errcode = '23514',
      message = 'inbox_v2.employee_conversation_state_read_cursor_regression';
  end if;

  if new.revision <> old.revision + 1
     or new.last_changed_stream_position <= old.last_changed_stream_position
     or new.updated_at < old.updated_at then
    raise exception using errcode = '23514',
      message = 'inbox_v2.employee_conversation_state_revision_stream_regression';
  end if;

  if new.last_read_sequence = old.last_read_sequence then
    if new.last_read_at is distinct from old.last_read_at then
      raise exception using errcode = '23514',
        message = 'inbox_v2.employee_conversation_state_read_timestamp_without_advance';
    end if;
  elsif new.last_read_at is distinct from new.updated_at then
    raise exception using errcode = '23514',
      message = 'inbox_v2.employee_conversation_state_read_timestamp_mismatch';
  end if;

  if ((new.manual_unread is not distinct from old.manual_unread)
       and new.manual_unread_changed_at is distinct from old.manual_unread_changed_at)
     or ((new.manual_unread is distinct from old.manual_unread)
       and new.manual_unread_changed_at is distinct from new.updated_at)
     or ((new.muted is not distinct from old.muted)
       and new.mute_changed_at is distinct from old.mute_changed_at)
     or ((new.muted is distinct from old.muted)
       and new.mute_changed_at is distinct from new.updated_at)
     or ((new.notification_level is not distinct from old.notification_level)
       and new.notification_level_changed_at is distinct from old.notification_level_changed_at)
     or ((new.notification_level is distinct from old.notification_level)
       and new.notification_level_changed_at is distinct from new.updated_at)
     or ((new.pinned is not distinct from old.pinned)
       and new.pin_changed_at is distinct from old.pin_changed_at)
     or ((new.pinned is distinct from old.pinned)
       and new.pin_changed_at is distinct from new.updated_at)
     or ((new.archived is not distinct from old.archived)
       and new.archive_changed_at is distinct from old.archive_changed_at)
     or ((new.archived is distinct from old.archived)
       and new.archive_changed_at is distinct from new.updated_at) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.employee_conversation_state_field_timestamp_mismatch';
  end if;

  if new.last_read_sequence = old.last_read_sequence
     and new.manual_unread = old.manual_unread
     and new.muted = old.muted
     and new.notification_level = old.notification_level
     and new.pinned = old.pinned
     and new.archived = old.archived then
    raise exception using errcode = '23514',
      message = 'inbox_v2.employee_conversation_state_phantom_update';
  end if;

  return new;
end;
$function$;

create or replace function public.inbox_v2_ecs_read_cursor_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if new.last_read_sequence > 0 and not exists (
    select 1
      from public.inbox_v2_timeline_items timeline_item
     where timeline_item.tenant_id = new.tenant_id
       and timeline_item.conversation_id = new.conversation_id
       and timeline_item.timeline_sequence = new.last_read_sequence
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.employee_conversation_state_read_cursor_not_in_conversation';
  end if;
  return null;
end;
$function$;

create trigger inbox_v2_ecs_state_guard_trigger
before insert or update on public.inbox_v2_employee_conversation_states
for each row execute function public.inbox_v2_ecs_state_guard();

create constraint trigger inbox_v2_ecs_read_cursor_constraint
after insert or update of last_read_sequence
on public.inbox_v2_employee_conversation_states
deferrable initially deferred
for each row execute function public.inbox_v2_ecs_read_cursor_guard();
`;
