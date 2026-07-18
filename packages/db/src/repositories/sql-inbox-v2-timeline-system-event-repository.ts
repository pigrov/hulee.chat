import {
  INBOX_V2_SYSTEM_EVENT_TIMELINE_CREATION_COMMIT_SCHEMA_ID,
  INBOX_V2_SYSTEM_EVENT_TIMELINE_CREATION_COMMIT_SCHEMA_VERSION,
  INBOX_V2_TIMELINE_ITEM_SCHEMA_ID,
  INBOX_V2_TIMELINE_SCHEMA_VERSION,
  inboxV2BigintCounterSchema,
  inboxV2ConversationSystemEventPayloadSchema,
  inboxV2PayloadReferenceSchema,
  inboxV2SystemEventTimelineCreationCommitSchema,
  type InboxV2AuthorizationDecisionReference,
  type InboxV2SystemEventTimelineCreationCommit,
  type InboxV2TimelineItem
} from "@hulee/contracts";
import { sql, type SQL } from "drizzle-orm";

import {
  assertInboxV2AuthorizedAtomicMaterializationContext,
  assertInboxV2AuthorizedCommandMutationContext,
  type InboxV2AuthorizedAtomicMaterializationContext,
  type InboxV2AuthorizedCommandMutationContext
} from "./sql-inbox-v2-authorization-repository";
import {
  issueInboxV2AtomicMaterializationSealReceipt,
  requireInboxV2AtomicSealExecutor,
  type InboxV2AtomicMaterializationSealReceipt
} from "./sql-inbox-v2-atomic-materialization-internal";
import type { RawSqlExecutor } from "./sql-outbox-repository";
import {
  InboxV2TimelineMessagePersistenceInvariantError,
  buildAdvanceInboxV2TimelineConversationHeadSql,
  buildInboxV2SafeGenericEnvelope,
  buildInsertInboxV2TimelineItemSql,
  computeInboxV2TimelineMessageCommitDigest,
  type InboxV2SafeGenericEnvelope
} from "./sql-inbox-v2-timeline-message-repository";

export const INBOX_V2_SYSTEM_EVENT_TIMELINE_COMMAND_TYPE_ID =
  "core:timeline.system_event.create" as const;
export const INBOX_V2_SYSTEM_EVENT_TIMELINE_PERMISSION_ID =
  "core:conversation.timeline_append_system" as const;

const inboxV2PreparedSystemEventTimelineCreationCapabilityBrand: unique symbol =
  Symbol("inbox-v2-prepared-system-event-timeline-creation-capability");

export type InboxV2PreparedSystemEventTimelineCreationCapability = Readonly<{
  [inboxV2PreparedSystemEventTimelineCreationCapabilityBrand]: true;
}>;

export type PrepareInboxV2SystemEventTimelineCreationResult =
  | Readonly<{
      kind: "ready";
      capability: InboxV2PreparedSystemEventTimelineCreationCapability;
    }>
  | Readonly<{
      kind: "conflict";
      code: "revision.conflict" | "timeline_item.identity_conflict";
    }>
  | Readonly<{
      kind: "conversation_not_found" | "source_event_not_found";
    }>;

export type SealInboxV2PreparedSystemEventTimelineCreationResult = Readonly<{
  kind: "created";
  timelineItem: InboxV2TimelineItem;
  envelope: InboxV2SafeGenericEnvelope;
  receipt: InboxV2AtomicMaterializationSealReceipt;
}>;

type LockedConversationRow = {
  conversation_tenant_id: unknown;
  conversation_id: unknown;
  topology: unknown;
  transport: unknown;
  purpose_id: unknown;
  lifecycle: unknown;
  entity_revision: unknown;
  conversation_created_at: unknown;
  conversation_updated_at: unknown;
  latest_timeline_sequence: unknown;
  latest_activity_item_id: unknown;
  latest_activity_timeline_sequence: unknown;
  latest_activity_at: unknown;
  head_revision: unknown;
  head_created_at: unknown;
  head_updated_at: unknown;
};

type ExistingTimelineItemRow = { id: unknown };
type SourceEventRow = {
  id: unknown;
  type: unknown;
  version: unknown;
  occurred_at: unknown;
  created_at: unknown;
  payload: unknown;
};

type PreparedState = {
  readonly executor: RawSqlExecutor;
  readonly atomicMaterializationToken: object;
  readonly commit: InboxV2SystemEventTimelineCreationCommit;
  readonly timelineItem: InboxV2TimelineItem;
  consumed: boolean;
};

const preparedSystemEventTimelineCreations = new WeakMap<
  InboxV2PreparedSystemEventTimelineCreationCapability,
  PreparedState
>();

export async function prepareInboxV2SystemEventTimelineCreation(
  context: InboxV2AuthorizedCommandMutationContext,
  input: Readonly<{ commit: InboxV2SystemEventTimelineCreationCommit }>
): Promise<PrepareInboxV2SystemEventTimelineCreationResult> {
  assertInboxV2AuthorizedCommandMutationContext(context);
  if (context.profile !== "domain") {
    throw invariantError(
      "Inbox V2 system-event Timeline preparation requires an authorized domain context."
    );
  }
  if (context.atomicMaterializationToken === undefined) {
    throw invariantError(
      "Inbox V2 system-event Timeline preparation requires an atomic materialization token."
    );
  }

  const commit = inboxV2SystemEventTimelineCreationCommitSchema.parse(
    input.commit
  );
  assertSystemEventTimelineCreationAuthority(context, commit);
  const item = commit.timelineAllocation.items[0];
  if (item === undefined || item.subject.kind !== "system_event") {
    throw invariantError(
      "Inbox V2 system-event Timeline commit has no system item."
    );
  }

  // The subject-detail FK is checked after the tenant stream head is locked.
  // Pin the owning event first so sealing never needs a new blocking domain
  // lock after the commit-safe stream position has been allocated.
  const eventResult = await context.executor.execute<SourceEventRow>(
    buildFindInboxV2SystemEventSourceSql({
      tenantId: commit.tenantId,
      eventId: commit.source.event.id
    })
  );
  assertAtMostOneRow(eventResult.rows, "system-event source lookup");
  const eventRow = eventResult.rows[0];
  if (eventRow === undefined) {
    return { kind: "source_event_not_found" };
  }
  if (!inboxV2SystemEventSourceRowMatches(eventRow, commit)) {
    return {
      kind: "conflict",
      code: "timeline_item.identity_conflict"
    };
  }

  const conversationResult =
    await context.executor.execute<LockedConversationRow>(
      buildLockInboxV2SystemEventTimelineConversationSql({
        tenantId: commit.tenantId,
        conversationId: item.conversation.id
      })
    );
  assertAtMostOneRow(conversationResult.rows, "system-event Conversation lock");
  const conversationRow = conversationResult.rows[0];
  if (conversationRow === undefined) {
    return { kind: "conversation_not_found" };
  }

  const existingEventItemResult =
    await context.executor.execute<ExistingTimelineItemRow>(
      buildFindInboxV2SystemEventTimelineSubjectSql({
        tenantId: commit.tenantId,
        conversationId: item.conversation.id,
        eventId: commit.source.event.id
      })
    );
  assertAtMostOneRow(
    existingEventItemResult.rows,
    "system-event Timeline subject lookup"
  );
  if (existingEventItemResult.rows.length !== 0) {
    return {
      kind: "conflict",
      code: "timeline_item.identity_conflict"
    };
  }

  const existingResult =
    await context.executor.execute<ExistingTimelineItemRow>(
      buildFindInboxV2SystemEventTimelineItemSql({
        tenantId: commit.tenantId,
        timelineItemId: item.id
      })
    );
  assertAtMostOneRow(existingResult.rows, "system-event TimelineItem lookup");
  if (existingResult.rows.length !== 0) {
    return {
      kind: "conflict",
      code: "timeline_item.identity_conflict"
    };
  }

  if (!lockedConversationMatches(conversationRow, commit)) {
    return { kind: "conflict", code: "revision.conflict" };
  }

  const capability = Object.freeze({
    [inboxV2PreparedSystemEventTimelineCreationCapabilityBrand]: true as const
  });
  preparedSystemEventTimelineCreations.set(capability, {
    executor: requireInboxV2AtomicSealExecutor(context),
    atomicMaterializationToken: context.atomicMaterializationToken,
    commit,
    timelineItem: item,
    consumed: false
  });
  return { kind: "ready", capability };
}

export async function sealInboxV2PreparedSystemEventTimelineCreation(
  context: InboxV2AuthorizedAtomicMaterializationContext,
  input: Readonly<{
    capability: InboxV2PreparedSystemEventTimelineCreationCapability;
  }>
): Promise<SealInboxV2PreparedSystemEventTimelineCreationResult> {
  assertInboxV2AuthorizedAtomicMaterializationContext(context);
  const prepared = preparedSystemEventTimelineCreations.get(input.capability);
  if (prepared === undefined) {
    throw invariantError(
      "System-event Timeline creation capability was not issued by this repository."
    );
  }
  if (
    prepared.atomicMaterializationToken !== context.atomicMaterializationToken
  ) {
    throw invariantError(
      "System-event Timeline creation capability belongs to a different atomic materialization."
    );
  }
  if (prepared.consumed) {
    throw invariantError(
      "System-event Timeline creation capability was already consumed."
    );
  }
  if (prepared.commit.tenantId !== context.tenantId) {
    throw invariantError(
      "System-event Timeline seal cannot cross the authorized tenant boundary."
    );
  }
  assertSystemEventTimelineCreationAuthority(context, prepared.commit);
  prepared.consumed = true;

  const streamPosition = inboxV2BigintCounterSchema.parse(
    context.streamPosition
  );
  await expectOneRow(
    prepared.executor,
    buildInsertInboxV2TimelineItemSql({
      item: prepared.timelineItem,
      streamPosition
    }),
    "system-event TimelineItem insert"
  );
  await expectOneRow(
    prepared.executor,
    buildInsertInboxV2SystemEventTimelineSubjectSql(prepared.commit),
    "system-event Timeline subject insert"
  );

  const beforeHead = prepared.commit.timelineAllocation.conversationBefore.head;
  const afterHead = prepared.commit.timelineAllocation.conversationAfter.head;
  await expectOneRow(
    prepared.executor,
    buildAdvanceInboxV2TimelineConversationHeadSql({
      tenantId: prepared.commit.tenantId,
      conversationId: prepared.timelineItem.conversation.id,
      expectedRevision: beforeHead.revision,
      expectedLatestSequence: beforeHead.latestTimelineSequence,
      latestSequence: afterHead.latestTimelineSequence,
      latestActivityItemId: afterHead.latestActivityItemId,
      latestActivitySequence: afterHead.latestActivityTimelineSequence,
      latestActivityAt: afterHead.latestActivityAt,
      streamPosition,
      changedAt: prepared.commit.timelineAllocation.committedAt
    }),
    "system-event Conversation-head advance"
  );

  const envelope = buildInboxV2SafeGenericEnvelope({
    tenantId: prepared.commit.tenantId,
    entityKind: "timeline_item",
    entityId: prepared.timelineItem.id,
    entityRevision: prepared.timelineItem.revision,
    timelineItemId: prepared.timelineItem.id,
    timelineSequence: prepared.timelineItem.timelineSequence,
    streamPosition,
    changeKind: "created",
    occurredAt: prepared.timelineItem.occurredAt
  });
  const payloadReference = atomicPayloadReference({
    tenantId: prepared.commit.tenantId,
    recordId: prepared.timelineItem.id,
    schemaId: INBOX_V2_TIMELINE_ITEM_SCHEMA_ID,
    schemaVersion: INBOX_V2_TIMELINE_SCHEMA_VERSION,
    payload: prepared.timelineItem
  });
  const domainCommitReference = atomicPayloadReference({
    tenantId: prepared.commit.tenantId,
    recordId: prepared.timelineItem.id,
    schemaId: INBOX_V2_SYSTEM_EVENT_TIMELINE_CREATION_COMMIT_SCHEMA_ID,
    schemaVersion:
      INBOX_V2_SYSTEM_EVENT_TIMELINE_CREATION_COMMIT_SCHEMA_VERSION,
    payload: prepared.commit
  });

  return {
    kind: "created",
    timelineItem: prepared.timelineItem,
    envelope,
    receipt: issueInboxV2AtomicMaterializationSealReceipt(
      context.atomicMaterializationToken,
      {
        kind: "timeline_item_creation",
        tenantId: prepared.commit.tenantId,
        timelineItemId: prepared.timelineItem.id,
        timelineItemRevision: prepared.timelineItem.revision,
        conversationId: prepared.timelineItem.conversation.id,
        timelineSequence: prepared.timelineItem.timelineSequence,
        subjectKind: "system_event",
        activityKind: "non_activity",
        audience: "workforce_metadata",
        stateSchemaId: INBOX_V2_TIMELINE_ITEM_SCHEMA_ID,
        stateSchemaVersion: INBOX_V2_TIMELINE_SCHEMA_VERSION,
        stateHash: payloadReference.digest,
        payloadReference,
        domainCommitReference,
        event: {
          typeId: "core:timeline.changed",
          payloadSchemaId:
            INBOX_V2_SYSTEM_EVENT_TIMELINE_CREATION_COMMIT_SCHEMA_ID,
          payloadSchemaVersion:
            INBOX_V2_SYSTEM_EVENT_TIMELINE_CREATION_COMMIT_SCHEMA_VERSION,
          payloadReference: domainCommitReference,
          occurredAt: prepared.timelineItem.occurredAt,
          recordedAt: prepared.commit.timelineAllocation.committedAt
        }
      }
    )
  };
}

export function buildLockInboxV2SystemEventTimelineConversationSql(input: {
  tenantId: string;
  conversationId: string;
}): SQL {
  return sql`
    select c.tenant_id as conversation_tenant_id,
           c.id as conversation_id, c.topology, c.transport, c.purpose_id,
           c.lifecycle, c.revision as entity_revision,
           c.created_at as conversation_created_at,
           c.updated_at as conversation_updated_at,
           h.latest_timeline_sequence, h.latest_activity_item_id,
           h.latest_activity_timeline_sequence, h.latest_activity_at,
           h.revision as head_revision, h.created_at as head_created_at,
           h.updated_at as head_updated_at
      from inbox_v2_conversations c
      inner join inbox_v2_conversation_heads h
        on h.tenant_id = c.tenant_id
       and h.conversation_id = c.id
     where c.tenant_id = ${input.tenantId}
       and c.id = ${input.conversationId}
     for update of c, h
  `;
}

export function buildFindInboxV2SystemEventTimelineItemSql(input: {
  tenantId: string;
  timelineItemId: string;
}): SQL {
  return sql`
    select id
      from inbox_v2_timeline_items
     where tenant_id = ${input.tenantId}
       and id = ${input.timelineItemId}
     for update
  `;
}

export function buildFindInboxV2SystemEventSourceSql(input: {
  tenantId: string;
  eventId: string;
}): SQL {
  return sql`
    select id, type, version, occurred_at, created_at, payload
      from event_store
     where tenant_id = ${input.tenantId}
       and id = ${input.eventId}
     for share
  `;
}

export function buildFindInboxV2SystemEventTimelineSubjectSql(input: {
  tenantId: string;
  conversationId: string;
  eventId: string;
}): SQL {
  return sql`
    select detail.timeline_item_id as id
      from inbox_v2_timeline_subject_details detail
      inner join inbox_v2_timeline_items item
        on item.tenant_id = detail.tenant_id
       and item.id = detail.timeline_item_id
       and item.subject_kind = detail.subject_kind
     where detail.tenant_id = ${input.tenantId}
       and detail.subject_kind = 'system_event'
       and detail.system_event_id = ${input.eventId}
       and item.conversation_id = ${input.conversationId}
     for update of detail, item
  `;
}

export function buildInsertInboxV2SystemEventTimelineSubjectSql(
  commit: InboxV2SystemEventTimelineCreationCommit
): SQL {
  const item = commit.timelineAllocation.items[0];
  if (item === undefined || item.subject.kind !== "system_event") {
    throw invariantError("System-event Timeline subject is missing.");
  }
  const actor = item.subject.appActor;
  if (actor === null) {
    throw invariantError("System-event Timeline app actor is missing.");
  }
  return sql`
    insert into inbox_v2_timeline_subject_details (
      tenant_id, timeline_item_id, subject_kind, system_event_id,
      system_actor_id, system_app_actor_kind,
      system_app_actor_employee_id, system_app_authorization_epoch,
      system_app_trusted_service_id, record_revision, created_at
    ) values (
      ${commit.tenantId}, ${item.id}, 'system_event',
      ${item.subject.event.id}, ${item.subject.systemActorId}, ${actor.kind},
      ${actor.kind === "employee" ? actor.employee.id : null},
      ${actor.kind === "employee" ? actor.authorizationEpoch : null},
      ${actor.kind === "trusted_service" ? actor.trustedServiceId : null},
      1, ${commit.timelineAllocation.committedAt}
    )
    returning timeline_item_id as id
  `;
}

export function assertSystemEventTimelineCreationAuthority(
  context: Readonly<{
    tenantId: string;
    commandTypeId: string;
    actor: InboxV2AuthorizedCommandMutationContext["actor"];
    authorizationEpoch: string;
    authorizationDecisionId: string;
    authorizationDecisionRefs: readonly InboxV2AuthorizationDecisionReference[];
    authorizationResourceRevisionFences: InboxV2AuthorizedCommandMutationContext["authorizationResourceRevisionFences"];
    occurredAt: string;
  }>,
  commit: InboxV2SystemEventTimelineCreationCommit
): void {
  const item = commit.timelineAllocation.items[0];
  const appActor =
    item?.subject.kind === "system_event" ? item.subject.appActor : null;
  const matchingDecisions = context.authorizationDecisionRefs.filter(
    (decision) => decision.id === context.authorizationDecisionId
  );
  const decision = matchingDecisions[0];
  const actorMatches =
    context.actor.kind === "trusted_service" &&
    appActor?.kind === "trusted_service" &&
    appActor.trustedServiceId === context.actor.trustedServiceId &&
    decision?.principal.kind === "trusted_service" &&
    decision.principal.trustedServiceId === context.actor.trustedServiceId;
  const matchingFences =
    decision === undefined || item === undefined
      ? []
      : context.authorizationResourceRevisionFences.filter(
          (fence) =>
            fence.resourceKind === "conversation" &&
            String(fence.resourceId) === String(item.conversation.id) &&
            String(fence.expectedResourceAccessRevision) ===
              String(decision.resourceAccessRevision) &&
            fence.advance === "none"
        );
  if (
    item === undefined ||
    item.subject.kind !== "system_event" ||
    commit.tenantId !== context.tenantId ||
    commit.timelineAllocation.committedAt !== context.occurredAt ||
    context.commandTypeId !== INBOX_V2_SYSTEM_EVENT_TIMELINE_COMMAND_TYPE_ID ||
    matchingDecisions.length !== 1 ||
    decision === undefined ||
    decision.tenantId !== context.tenantId ||
    decision.authorizationEpoch !== context.authorizationEpoch ||
    decision.permissionId !== INBOX_V2_SYSTEM_EVENT_TIMELINE_PERMISSION_ID ||
    decision.resourceScopeId !== "core:conversation" ||
    decision.outcome !== "allowed" ||
    decision.resource.tenantId !== context.tenantId ||
    decision.resource.entityTypeId !== "core:conversation" ||
    String(decision.resource.entityId) !== String(item.conversation.id) ||
    !actorMatches ||
    matchingFences.length !== 1
  ) {
    throw invariantError(
      "Inbox V2 system-event Timeline creation requires one exact trusted-service Conversation authorization decision and revision fence."
    );
  }
}

function lockedConversationMatches(
  row: LockedConversationRow,
  commit: InboxV2SystemEventTimelineCreationCommit
): boolean {
  const conversation = commit.timelineAllocation.conversationBefore;
  const head = conversation.head;
  return (
    String(row.conversation_tenant_id) === conversation.tenantId &&
    String(row.conversation_id) === conversation.id &&
    String(row.topology) === conversation.topology &&
    String(row.transport) === conversation.transport &&
    String(row.purpose_id) === conversation.purposeId &&
    String(row.lifecycle) === conversation.lifecycle &&
    databaseBigint(row.entity_revision) === conversation.revision &&
    databaseTimestamp(row.conversation_created_at) === conversation.createdAt &&
    databaseTimestamp(row.conversation_updated_at) === conversation.updatedAt &&
    databaseBigint(row.latest_timeline_sequence) ===
      head.latestTimelineSequence &&
    nullableString(row.latest_activity_item_id) === head.latestActivityItemId &&
    nullableBigint(row.latest_activity_timeline_sequence) ===
      head.latestActivityTimelineSequence &&
    nullableTimestamp(row.latest_activity_at) === head.latestActivityAt &&
    databaseBigint(row.head_revision) === head.revision &&
    databaseTimestamp(row.head_created_at) === head.createdAt &&
    databaseTimestamp(row.head_updated_at) === head.updatedAt
  );
}

export function inboxV2SystemEventSourceRowMatches(
  row: SourceEventRow,
  commit: InboxV2SystemEventTimelineCreationCommit
): boolean {
  const payload = inboxV2ConversationSystemEventPayloadSchema.safeParse(
    row.payload
  );
  return (
    payload.success &&
    String(row.id) === commit.source.event.id &&
    String(row.type) === commit.source.eventTypeId &&
    String(row.version) === commit.source.eventVersion &&
    databaseTimestamp(row.occurred_at) === commit.source.occurredAt &&
    databaseTimestamp(row.created_at) === commit.source.recordedAt &&
    payload.data.conversation.tenantId ===
      commit.source.conversation.tenantId &&
    payload.data.conversation.id === commit.source.conversation.id &&
    payload.data.recordedAt === commit.source.recordedAt &&
    `sha256:${computeInboxV2TimelineMessageCommitDigest(row.payload)}` ===
      commit.source.payloadDigest
  );
}

function atomicPayloadReference(input: {
  tenantId: string;
  recordId: string;
  schemaId: string;
  schemaVersion: string;
  payload: unknown;
}) {
  return inboxV2PayloadReferenceSchema.parse({
    tenantId: input.tenantId,
    recordId: input.recordId,
    schemaId: input.schemaId,
    schemaVersion: input.schemaVersion,
    digest:
      `sha256:${computeInboxV2TimelineMessageCommitDigest(input.payload)}` as const
  });
}

async function expectOneRow(
  executor: RawSqlExecutor,
  statement: SQL,
  operation: string
): Promise<void> {
  const result = await executor.execute<Record<string, unknown>>(statement);
  if (result.rows.length !== 1) {
    throw invariantError(`${operation} did not affect exactly one row.`);
  }
}

function assertAtMostOneRow(rows: readonly unknown[], operation: string): void {
  if (rows.length > 1) {
    throw invariantError(`${operation} returned more than one row.`);
  }
}

function databaseBigint(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "bigint") {
    throw invariantError("System-event persistence decoded a bigint unsafely.");
  }
  return String(value);
}

function nullableBigint(value: unknown): string | null {
  return value === null ? null : databaseBigint(value);
}

function databaseTimestamp(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw invariantError(
      "System-event persistence decoded an invalid timestamp."
    );
  }
  return date.toISOString();
}

function nullableTimestamp(value: unknown): string | null {
  return value === null ? null : databaseTimestamp(value);
}

function nullableString(value: unknown): string | null {
  return value === null ? null : String(value);
}

function invariantError(
  message: string
): InboxV2TimelineMessagePersistenceInvariantError {
  return new InboxV2TimelineMessagePersistenceInvariantError(message);
}
