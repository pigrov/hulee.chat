import {
  inboxV2ConversationIdSchema,
  inboxV2EmployeeIdSchema,
  inboxV2TenantIdSchema,
  inboxV2TimestampSchema,
  type InboxV2ConversationId,
  type InboxV2EmployeeId,
  type InboxV2TenantId
} from "@hulee/contracts";
import { CoreError } from "@hulee/core";
import { sql, type SQL } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import type { RawSqlExecutor } from "./sql-outbox-repository";

export type InboxV2EffectiveConversationAccessSnapshot = Readonly<{
  /** Opaque identity of one already-resolved effective-access snapshot. */
  snapshotId: string;
  authorizationEpoch: string;
  /** The server-resolved principal binding; never supplied by a page cursor. */
  tenantId: InboxV2TenantId;
  employeeId: InboxV2EmployeeId;
  tenantWideExternalRead: boolean;
  explicitConversationIds: readonly InboxV2ConversationId[];
  workItemIds: readonly string[];
  queueIds: readonly string[];
  orgUnitIds: readonly string[];
  teamIds: readonly string[];
  allowResponsible: boolean;
  allowCollaborator: boolean;
  allowInternalParticipant: boolean;
}>;

export type InboxV2ConversationAccessCursor = Readonly<{
  latestActivityAt: string | null;
  conversationId: InboxV2ConversationId;
}>;

export type ListActorVisibleInboxV2ConversationsInput = Readonly<{
  tenantId: InboxV2TenantId;
  employeeId: InboxV2EmployeeId;
  access: InboxV2EffectiveConversationAccessSnapshot;
  cursor?: InboxV2ConversationAccessCursor;
  limit: number;
}>;

export type InboxV2ActorVisibleConversationRecord = Readonly<{
  tenantId: InboxV2TenantId;
  conversationId: InboxV2ConversationId;
  topology: "direct" | "group" | "case" | "object";
  transport: "internal" | "external";
  lifecycle: "active" | "ended";
  purposeId: string;
  latestTimelineSequence: string;
  latestActivityItemId: string | null;
  latestActivityTimelineSequence: string | null;
  latestActivityAt: string | null;
  updatedAt: string;
}>;

export type InboxV2ActorVisibleConversationPage = Readonly<{
  items: readonly InboxV2ActorVisibleConversationRecord[];
  nextCursor: InboxV2ConversationAccessCursor | null;
  accessSnapshotId: string;
  authorizationEpoch: string;
}>;

export type InboxV2ActorVisibleAccessPlanRepository = Readonly<{
  list(
    input: ListActorVisibleInboxV2ConversationsInput
  ): Promise<InboxV2ActorVisibleConversationPage>;
  count(
    input: Omit<ListActorVisibleInboxV2ConversationsInput, "cursor" | "limit">
  ): Promise<number>;
}>;

type ConversationRow = {
  tenant_id: unknown;
  conversation_id: unknown;
  topology: unknown;
  transport: unknown;
  lifecycle: unknown;
  purpose_id: unknown;
  latest_timeline_sequence: unknown;
  latest_activity_item_id: unknown;
  latest_activity_timeline_sequence: unknown;
  latest_activity_at: unknown;
  updated_at: unknown;
};

type CountRow = { visible_count: unknown };

const MAX_PAGE_SIZE = 200;
const MAX_SCOPE_VALUES = 10_000;

export function createSqlInboxV2ActorVisibleAccessPlanRepository(
  executor: RawSqlExecutor | HuleeDatabase
): InboxV2ActorVisibleAccessPlanRepository {
  const rawExecutor = executor as RawSqlExecutor;

  return {
    async list(input) {
      const normalized = normalizeListInput(input);
      const result = await rawExecutor.execute<ConversationRow>(
        buildListActorVisibleInboxV2ConversationsSql({
          ...normalized,
          limit: normalized.limit + 1
        })
      );
      const mapped = result.rows.map((row) =>
        mapConversationRow(row, normalized.tenantId)
      );
      const hasNext = mapped.length > normalized.limit;
      const items = hasNext ? mapped.slice(0, normalized.limit) : mapped;
      const last = items.at(-1);

      return Object.freeze({
        items: Object.freeze(items),
        nextCursor:
          hasNext && last !== undefined
            ? Object.freeze({
                latestActivityAt: last.latestActivityAt,
                conversationId: last.conversationId
              })
            : null,
        accessSnapshotId: normalized.access.snapshotId,
        authorizationEpoch: normalized.access.authorizationEpoch
      });
    },

    async count(input) {
      const normalized = normalizeBaseInput(input);
      const result = await rawExecutor.execute<CountRow>(
        buildCountActorVisibleInboxV2ConversationsSql(normalized)
      );
      if (result.rows.length !== 1) {
        throw new InboxV2AccessPlanInvariantError(
          "Actor-visible count must return exactly one row."
        );
      }
      const count = parseNonNegativeSafeInteger(
        result.rows[0]?.visible_count,
        "visible_count"
      );
      return count;
    }
  };
}

export function buildListActorVisibleInboxV2ConversationsSql(
  input: ListActorVisibleInboxV2ConversationsInput
): SQL {
  const normalized = normalizeListInput(input);
  const access = accessSnapshotJson(normalized.access);
  const cursor = buildActivityCursorSql(normalized.cursor);

  return normalized.access.tenantWideExternalRead
    ? sql`
        with access_snapshot as materialized (
          select ${access}::jsonb as value
        )
        select head.tenant_id,
               head.conversation_id,
               conversation.topology,
               conversation.transport,
               conversation.lifecycle,
               conversation.purpose_id,
               head.latest_timeline_sequence,
               head.latest_activity_item_id,
               head.latest_activity_timeline_sequence,
               head.latest_activity_at,
               head.updated_at
          from inbox_v2_conversation_heads head
          join inbox_v2_conversations conversation
            on conversation.tenant_id = head.tenant_id
           and conversation.id = head.conversation_id
         cross join access_snapshot snapshot
         where head.tenant_id = ${normalized.tenantId}
           and (${cursor})
           and (
             conversation.transport = 'external'
             or head.conversation_id in (
               select jsonb_array_elements_text(
                 snapshot.value->'explicitConversationIds'
               )
             )
             or (${normalized.access.allowInternalParticipant} and exists (
               select 1
                 from inbox_v2_conversation_participants participant
                 join inbox_v2_participant_membership_episodes episode
                   on episode.tenant_id = participant.tenant_id
                  and episode.participant_id = participant.id
                  and episode.conversation_id = participant.conversation_id
                where participant.tenant_id = head.tenant_id
                  and participant.subject_employee_id = ${normalized.employeeId}
                  and participant.conversation_id = head.conversation_id
                  and episode.origin_kind = 'hulee_internal_command'
                  and episode.state = 'active'
             ))
           )
         order by head.latest_activity_at desc nulls last,
                  head.conversation_id asc
         limit ${normalized.limit}
      `
    : sql`
        with access_snapshot as materialized (
          select ${access}::jsonb as value
        ), authorized_conversations as materialized (
          select explicit_id.conversation_id
            from access_snapshot snapshot
            cross join lateral jsonb_array_elements_text(
              snapshot.value->'explicitConversationIds'
            ) explicit_id(conversation_id)
          union
          select structural.conversation_id
            from inbox_v2_auth_structural_access_heads structural
            join access_snapshot snapshot on true
           where structural.tenant_id = ${normalized.tenantId}
             and structural.resource_kind = 'conversation'
             and structural.target_kind = 'org_unit'
             and structural.current_state = 'active'
             and structural.target_org_unit_id in (
               select jsonb_array_elements_text(snapshot.value->'orgUnitIds')
             )
          union
          select structural.conversation_id
            from inbox_v2_auth_structural_access_heads structural
            join access_snapshot snapshot on true
           where structural.tenant_id = ${normalized.tenantId}
             and structural.resource_kind = 'conversation'
             and structural.target_kind = 'team'
             and structural.current_state = 'active'
             and structural.target_team_id in (
               select jsonb_array_elements_text(snapshot.value->'teamIds')
             )
          union
          select work_item.conversation_id
            from inbox_v2_work_items work_item
            join access_snapshot snapshot on true
           where work_item.tenant_id = ${normalized.tenantId}
             and work_item.state in ('new', 'assigned', 'in_progress', 'waiting')
             and (
               work_item.id in (
                 select jsonb_array_elements_text(snapshot.value->'workItemIds')
               )
               or work_item.queue_id in (
                 select jsonb_array_elements_text(snapshot.value->'queueIds')
               )
             )
          union
          select work_item.conversation_id
            from inbox_v2_work_item_primary_assignments assignment
            join inbox_v2_work_items work_item
              on work_item.tenant_id = assignment.tenant_id
             and work_item.id = assignment.work_item_id
           where ${normalized.access.allowResponsible}
             and assignment.tenant_id = ${normalized.tenantId}
             and assignment.employee_id = ${normalized.employeeId}
             and assignment.state = 'active'
          union
          select coalesce(collaborator.conversation_id, work_item.conversation_id)
            from inbox_v2_auth_collaborator_heads collaborator
            left join inbox_v2_work_items work_item
              on work_item.tenant_id = collaborator.tenant_id
             and work_item.id = collaborator.work_item_id
           where ${normalized.access.allowCollaborator}
             and collaborator.tenant_id = ${normalized.tenantId}
             and collaborator.employee_id = ${normalized.employeeId}
             and collaborator.current_state = 'active'
          union
          select participant.conversation_id
            from inbox_v2_conversation_participants participant
            join inbox_v2_participant_membership_episodes episode
              on episode.tenant_id = participant.tenant_id
             and episode.participant_id = participant.id
             and episode.conversation_id = participant.conversation_id
           where ${normalized.access.allowInternalParticipant}
             and participant.tenant_id = ${normalized.tenantId}
             and participant.subject_employee_id = ${normalized.employeeId}
             and episode.origin_kind = 'hulee_internal_command'
             and episode.state = 'active'
        )
        select head.tenant_id,
               head.conversation_id,
               conversation.topology,
               conversation.transport,
               conversation.lifecycle,
               conversation.purpose_id,
               head.latest_timeline_sequence,
               head.latest_activity_item_id,
               head.latest_activity_timeline_sequence,
               head.latest_activity_at,
               head.updated_at
          from authorized_conversations access
          join inbox_v2_conversation_heads head
            on head.tenant_id = ${normalized.tenantId}
           and head.conversation_id = access.conversation_id
          join inbox_v2_conversations conversation
            on conversation.tenant_id = head.tenant_id
           and conversation.id = head.conversation_id
         cross join access_snapshot snapshot
         where (${cursor})
           and (
             conversation.transport = 'external'
             or head.conversation_id in (
               select jsonb_array_elements_text(
                 snapshot.value->'explicitConversationIds'
               )
             )
             or (${normalized.access.allowInternalParticipant} and exists (
               select 1
                 from inbox_v2_conversation_participants participant
                 join inbox_v2_participant_membership_episodes episode
                   on episode.tenant_id = participant.tenant_id
                  and episode.participant_id = participant.id
                  and episode.conversation_id = participant.conversation_id
                where participant.tenant_id = head.tenant_id
                  and participant.subject_employee_id = ${normalized.employeeId}
                  and participant.conversation_id = head.conversation_id
                  and episode.origin_kind = 'hulee_internal_command'
                  and episode.state = 'active'
             ))
           )
         order by head.latest_activity_at desc nulls last,
                  head.conversation_id asc
         limit ${normalized.limit}
      `;
}

export function buildCountActorVisibleInboxV2ConversationsSql(
  input: Omit<ListActorVisibleInboxV2ConversationsInput, "cursor" | "limit">
): SQL {
  const normalized = normalizeBaseInput(input);
  const access = accessSnapshotJson(normalized.access);

  if (normalized.access.tenantWideExternalRead) {
    return sql`
      with access_snapshot as materialized (
        select ${access}::jsonb as value
      )
      select count(*)::bigint as visible_count
        from inbox_v2_conversation_heads head
        join inbox_v2_conversations conversation
          on conversation.tenant_id = head.tenant_id
         and conversation.id = head.conversation_id
       cross join access_snapshot snapshot
       where head.tenant_id = ${normalized.tenantId}
         and (
           conversation.transport = 'external'
           or head.conversation_id in (
             select jsonb_array_elements_text(
               snapshot.value->'explicitConversationIds'
             )
           )
           or (${normalized.access.allowInternalParticipant} and exists (
             select 1
               from inbox_v2_conversation_participants participant
               join inbox_v2_participant_membership_episodes episode
                 on episode.tenant_id = participant.tenant_id
                and episode.participant_id = participant.id
                and episode.conversation_id = participant.conversation_id
              where participant.tenant_id = head.tenant_id
                and participant.subject_employee_id = ${normalized.employeeId}
                and participant.conversation_id = head.conversation_id
                and episode.origin_kind = 'hulee_internal_command'
                and episode.state = 'active'
           ))
         )
    `;
  }

  return sql`
    with access_snapshot as materialized (
      select ${access}::jsonb as value
    ), authorized_conversations as materialized (
      select explicit_id.conversation_id
        from access_snapshot snapshot
        cross join lateral jsonb_array_elements_text(
          snapshot.value->'explicitConversationIds'
        ) explicit_id(conversation_id)
      union
      select structural.conversation_id
        from inbox_v2_auth_structural_access_heads structural
        join access_snapshot snapshot on true
       where structural.tenant_id = ${normalized.tenantId}
         and structural.resource_kind = 'conversation'
         and structural.target_kind = 'org_unit'
         and structural.current_state = 'active'
         and structural.target_org_unit_id in (
           select jsonb_array_elements_text(snapshot.value->'orgUnitIds')
         )
      union
      select structural.conversation_id
        from inbox_v2_auth_structural_access_heads structural
        join access_snapshot snapshot on true
       where structural.tenant_id = ${normalized.tenantId}
         and structural.resource_kind = 'conversation'
         and structural.target_kind = 'team'
         and structural.current_state = 'active'
         and structural.target_team_id in (
           select jsonb_array_elements_text(snapshot.value->'teamIds')
         )
      union
      select work_item.conversation_id
        from inbox_v2_work_items work_item
        join access_snapshot snapshot on true
       where work_item.tenant_id = ${normalized.tenantId}
         and work_item.state in ('new', 'assigned', 'in_progress', 'waiting')
         and (
           work_item.id in (
             select jsonb_array_elements_text(snapshot.value->'workItemIds')
           )
           or work_item.queue_id in (
             select jsonb_array_elements_text(snapshot.value->'queueIds')
           )
         )
      union
      select work_item.conversation_id
        from inbox_v2_work_item_primary_assignments assignment
        join inbox_v2_work_items work_item
          on work_item.tenant_id = assignment.tenant_id
         and work_item.id = assignment.work_item_id
       where ${normalized.access.allowResponsible}
         and assignment.tenant_id = ${normalized.tenantId}
         and assignment.employee_id = ${normalized.employeeId}
         and assignment.state = 'active'
      union
      select coalesce(collaborator.conversation_id, work_item.conversation_id)
        from inbox_v2_auth_collaborator_heads collaborator
        left join inbox_v2_work_items work_item
          on work_item.tenant_id = collaborator.tenant_id
         and work_item.id = collaborator.work_item_id
       where ${normalized.access.allowCollaborator}
         and collaborator.tenant_id = ${normalized.tenantId}
         and collaborator.employee_id = ${normalized.employeeId}
         and collaborator.current_state = 'active'
      union
      select participant.conversation_id
        from inbox_v2_conversation_participants participant
        join inbox_v2_participant_membership_episodes episode
          on episode.tenant_id = participant.tenant_id
         and episode.participant_id = participant.id
         and episode.conversation_id = participant.conversation_id
       where ${normalized.access.allowInternalParticipant}
         and participant.tenant_id = ${normalized.tenantId}
         and participant.subject_employee_id = ${normalized.employeeId}
         and episode.origin_kind = 'hulee_internal_command'
         and episode.state = 'active'
    )
    select count(*)::bigint as visible_count
      from authorized_conversations access
      join inbox_v2_conversation_heads head
        on head.tenant_id = ${normalized.tenantId}
       and head.conversation_id = access.conversation_id
      join inbox_v2_conversations conversation
        on conversation.tenant_id = head.tenant_id
       and conversation.id = head.conversation_id
     cross join access_snapshot snapshot
     where conversation.transport = 'external'
        or head.conversation_id in (
          select jsonb_array_elements_text(
            snapshot.value->'explicitConversationIds'
          )
        )
        or (${normalized.access.allowInternalParticipant} and exists (
          select 1
            from inbox_v2_conversation_participants participant
            join inbox_v2_participant_membership_episodes episode
              on episode.tenant_id = participant.tenant_id
             and episode.participant_id = participant.id
             and episode.conversation_id = participant.conversation_id
           where participant.tenant_id = head.tenant_id
             and participant.subject_employee_id = ${normalized.employeeId}
             and participant.conversation_id = head.conversation_id
             and episode.origin_kind = 'hulee_internal_command'
             and episode.state = 'active'
        ))
  `;
}

function buildActivityCursorSql(
  cursor: InboxV2ConversationAccessCursor | undefined
): SQL {
  if (cursor === undefined) {
    return sql`true`;
  }
  if (cursor.latestActivityAt === null) {
    return sql`head.latest_activity_at is null
      and head.conversation_id > ${cursor.conversationId}`;
  }
  return sql`(
    head.latest_activity_at < ${cursor.latestActivityAt}
    or head.latest_activity_at is null
    or (
      head.latest_activity_at = ${cursor.latestActivityAt}
      and head.conversation_id > ${cursor.conversationId}
    )
  )`;
}

function normalizeListInput(
  input: ListActorVisibleInboxV2ConversationsInput
): ListActorVisibleInboxV2ConversationsInput {
  const base = normalizeBaseInput(input);
  if (
    !Number.isInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > MAX_PAGE_SIZE + 1
  ) {
    throw new CoreError(
      "validation.failed",
      "Inbox page size is out of range."
    );
  }
  const cursor =
    input.cursor === undefined
      ? undefined
      : Object.freeze({
          latestActivityAt:
            input.cursor.latestActivityAt === null
              ? null
              : inboxV2TimestampSchema.parse(input.cursor.latestActivityAt),
          conversationId: inboxV2ConversationIdSchema.parse(
            input.cursor.conversationId
          )
        });
  return Object.freeze({ ...base, cursor, limit: input.limit });
}

function normalizeBaseInput(
  input: Omit<ListActorVisibleInboxV2ConversationsInput, "cursor" | "limit">
): Omit<ListActorVisibleInboxV2ConversationsInput, "cursor" | "limit"> {
  const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
  const employeeId = inboxV2EmployeeIdSchema.parse(input.employeeId);
  const access = normalizeAccessSnapshot(input.access, {
    tenantId,
    employeeId
  });
  return Object.freeze({ tenantId, employeeId, access });
}

function normalizeAccessSnapshot(
  input: InboxV2EffectiveConversationAccessSnapshot,
  expected: Readonly<{
    tenantId: InboxV2TenantId;
    employeeId: InboxV2EmployeeId;
  }>
): InboxV2EffectiveConversationAccessSnapshot {
  const snapshotId = nonEmptyToken(input.snapshotId, "snapshotId");
  const authorizationEpoch = nonEmptyToken(
    input.authorizationEpoch,
    "authorizationEpoch"
  );
  const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
  if (tenantId !== expected.tenantId) {
    throw new CoreError("tenant.boundary_violation");
  }
  const employeeId = inboxV2EmployeeIdSchema.parse(input.employeeId);
  if (employeeId !== expected.employeeId) {
    throw new CoreError("permission.denied");
  }
  const explicitConversationIds = normalizeIdArray(
    input.explicitConversationIds,
    "explicitConversationIds",
    (value) => inboxV2ConversationIdSchema.parse(value)
  );
  return Object.freeze({
    snapshotId,
    authorizationEpoch,
    tenantId,
    employeeId,
    tenantWideExternalRead: input.tenantWideExternalRead === true,
    explicitConversationIds,
    workItemIds: normalizeIdArray(input.workItemIds, "workItemIds"),
    queueIds: normalizeIdArray(input.queueIds, "queueIds"),
    orgUnitIds: normalizeIdArray(input.orgUnitIds, "orgUnitIds"),
    teamIds: normalizeIdArray(input.teamIds, "teamIds"),
    allowResponsible: input.allowResponsible === true,
    allowCollaborator: input.allowCollaborator === true,
    allowInternalParticipant: input.allowInternalParticipant === true
  });
}

function normalizeIdArray<T extends string>(
  values: readonly T[],
  field: string,
  parse: (value: T) => T = (value) => nonEmptyToken(value, field) as T
): readonly T[] {
  if (!Array.isArray(values) || values.length > MAX_SCOPE_VALUES) {
    throw new CoreError(
      "validation.failed",
      `${field} exceeds the bounded access snapshot size.`
    );
  }
  const normalized = values.map(parse);
  if (new Set(normalized).size !== normalized.length) {
    throw new CoreError(
      "validation.failed",
      `${field} must not contain duplicates.`
    );
  }
  return Object.freeze([...normalized]);
}

function accessSnapshotJson(
  access: InboxV2EffectiveConversationAccessSnapshot
): string {
  return JSON.stringify({
    explicitConversationIds: access.explicitConversationIds,
    workItemIds: access.workItemIds,
    queueIds: access.queueIds,
    orgUnitIds: access.orgUnitIds,
    teamIds: access.teamIds
  });
}

function mapConversationRow(
  row: ConversationRow,
  expectedTenantId: InboxV2TenantId
): InboxV2ActorVisibleConversationRecord {
  const tenantId = inboxV2TenantIdSchema.parse(row.tenant_id);
  if (tenantId !== expectedTenantId) {
    throw new CoreError("tenant.boundary_violation");
  }
  const topology = parseEnum(row.topology, "topology", [
    "direct",
    "group",
    "case",
    "object"
  ] as const);
  const transport = parseEnum(row.transport, "transport", [
    "internal",
    "external"
  ] as const);
  const lifecycle = parseEnum(row.lifecycle, "lifecycle", [
    "active",
    "ended"
  ] as const);
  return Object.freeze({
    tenantId,
    conversationId: inboxV2ConversationIdSchema.parse(row.conversation_id),
    topology,
    transport,
    lifecycle,
    purposeId: nonEmptyToken(row.purpose_id, "purpose_id"),
    latestTimelineSequence: parseBigintString(
      row.latest_timeline_sequence,
      "latest_timeline_sequence"
    ),
    latestActivityItemId: nullableString(
      row.latest_activity_item_id,
      "latest_activity_item_id"
    ),
    latestActivityTimelineSequence:
      row.latest_activity_timeline_sequence === null
        ? null
        : parseBigintString(
            row.latest_activity_timeline_sequence,
            "latest_activity_timeline_sequence"
          ),
    latestActivityAt:
      row.latest_activity_at === null
        ? null
        : parseTimestamp(row.latest_activity_at, "latest_activity_at"),
    updatedAt: parseTimestamp(row.updated_at, "updated_at")
  });
}

export class InboxV2AccessPlanInvariantError extends Error {
  readonly code = "inbox_v2.access_plan_invariant" as const;

  constructor(message: string) {
    super(message);
    this.name = "InboxV2AccessPlanInvariantError";
  }
}

function parseTimestamp(value: unknown, field: string): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  try {
    return inboxV2TimestampSchema.parse(value);
  } catch {
    throw new InboxV2AccessPlanInvariantError(`${field} is invalid.`);
  }
}

function parseBigintString(value: unknown, field: string): string {
  if (typeof value !== "string" && typeof value !== "bigint") {
    throw new InboxV2AccessPlanInvariantError(`${field} is invalid.`);
  }
  try {
    const parsed = BigInt(value);
    if (parsed < 0n) {
      throw new Error();
    }
    return parsed.toString();
  } catch {
    throw new InboxV2AccessPlanInvariantError(`${field} is invalid.`);
  }
}

function parseNonNegativeSafeInteger(value: unknown, field: string): number {
  const parsed = parseBigintString(value, field);
  const numeric = Number(parsed);
  if (!Number.isSafeInteger(numeric)) {
    throw new InboxV2AccessPlanInvariantError(`${field} exceeds safe range.`);
  }
  return numeric;
}

function nullableString(value: unknown, field: string): string | null {
  return value === null ? null : nonEmptyToken(value, field);
}

function nonEmptyToken(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 512) {
    throw new CoreError("validation.failed", `${field} is invalid.`);
  }
  return value;
}

function parseEnum<const T extends readonly string[]>(
  value: unknown,
  field: string,
  values: T
): T[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    throw new InboxV2AccessPlanInvariantError(`${field} is invalid.`);
  }
  return value as T[number];
}
