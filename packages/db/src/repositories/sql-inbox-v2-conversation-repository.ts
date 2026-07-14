import {
  inboxV2BigintCounterSchema,
  inboxV2ConversationIdSchema,
  inboxV2ConversationLifecycleSchema,
  inboxV2ConversationPurposeIdSchema,
  inboxV2ConversationSchema,
  inboxV2ConversationTopologySchema,
  inboxV2ConversationTransportSchema,
  inboxV2EntityRevisionSchema,
  inboxV2TenantIdSchema,
  inboxV2TimelineItemIdSchema,
  inboxV2TimelineSequenceSchema,
  inboxV2TimestampSchema,
  type InboxV2BigintCounter,
  type InboxV2Conversation,
  type InboxV2ConversationId,
  type InboxV2ConversationLifecycle,
  type InboxV2ConversationPurposeId,
  type InboxV2ConversationTopology,
  type InboxV2ConversationTransport,
  type InboxV2EntityRevision,
  type InboxV2TenantId,
  type InboxV2TimelineItemId,
  type InboxV2TimelineSequence
} from "@hulee/contracts";
import { CoreError } from "@hulee/core";
import { sql, type SQL } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";

const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;
const MAX_TIMELINE_ALLOCATION_SIZE = 1_000;

export type InboxV2ConversationPersistenceRecord = Readonly<{
  aggregate: InboxV2Conversation;
  entityLastChangedStreamPosition: InboxV2BigintCounter;
  headLastChangedStreamPosition: InboxV2BigintCounter;
}>;

export type CreateInboxV2ConversationInput = Readonly<{
  tenantId: InboxV2TenantId;
  conversationId: InboxV2ConversationId;
  topology: InboxV2ConversationTopology;
  transport: InboxV2ConversationTransport;
  purposeId: InboxV2ConversationPurposeId;
  lifecycle?: InboxV2ConversationLifecycle;
  streamPosition: InboxV2BigintCounter;
  createdAt: string;
}>;

export type CreateInboxV2ConversationResult =
  | Readonly<{
      kind: "created";
      record: InboxV2ConversationPersistenceRecord;
    }>
  | Readonly<{
      kind: "already_exists";
      record: InboxV2ConversationPersistenceRecord;
    }>
  | Readonly<{
      kind: "identity_conflict";
      record: InboxV2ConversationPersistenceRecord;
    }>;

export type CompareAndSetInboxV2ConversationInput = Readonly<{
  tenantId: InboxV2TenantId;
  conversationId: InboxV2ConversationId;
  expectedRevision: InboxV2EntityRevision;
  next: Readonly<{
    topology: InboxV2ConversationTopology;
    transport: InboxV2ConversationTransport;
    purposeId: InboxV2ConversationPurposeId;
    lifecycle: InboxV2ConversationLifecycle;
  }>;
  streamPosition: InboxV2BigintCounter;
  changedAt: string;
}>;

export type CompareAndSetInboxV2ConversationResult =
  | Readonly<{
      kind: "updated" | "no_op" | "revision_conflict";
      record: InboxV2ConversationPersistenceRecord;
    }>
  | Readonly<{ kind: "not_found" }>;

export type InboxV2TimelineAllocationItem = Readonly<{
  itemId: InboxV2TimelineItemId;
  occurredAt: string;
  activityEligible: boolean;
}>;

export type AllocateInboxV2TimelineRangeInput = Readonly<{
  tenantId: InboxV2TenantId;
  conversationId: InboxV2ConversationId;
  expectedHeadRevision: InboxV2EntityRevision;
  items: readonly InboxV2TimelineAllocationItem[];
  streamPosition: InboxV2BigintCounter;
  changedAt: string;
}>;

export type InboxV2TimelineSequenceAssignment = Readonly<{
  itemId: InboxV2TimelineItemId;
  timelineSequence: InboxV2TimelineSequence;
}>;

export type InboxV2TimelineRangeAllocation = Readonly<{
  firstSequence: InboxV2TimelineSequence;
  lastSequence: InboxV2TimelineSequence;
  assignments: readonly InboxV2TimelineSequenceAssignment[];
}>;

export type AllocateInboxV2TimelineRangeResult<TResult> =
  | Readonly<{
      kind: "allocated";
      allocation: InboxV2TimelineRangeAllocation;
      record: InboxV2ConversationPersistenceRecord;
      result: TResult;
    }>
  | Readonly<{
      kind: "revision_conflict";
      record: InboxV2ConversationPersistenceRecord;
    }>
  | Readonly<{ kind: "not_found" }>;

export type InboxV2ConversationTransactionExecutor = RawSqlExecutor & {
  transaction<TResult>(
    work: (transaction: RawSqlExecutor) => Promise<TResult>
  ): Promise<TResult>;
};

export type InboxV2ConversationRepository = Readonly<{
  create(
    input: CreateInboxV2ConversationInput
  ): Promise<CreateInboxV2ConversationResult>;
  findById(input: {
    tenantId: InboxV2TenantId;
    conversationId: InboxV2ConversationId;
  }): Promise<InboxV2ConversationPersistenceRecord | null>;
  compareAndSet(
    input: CompareAndSetInboxV2ConversationInput
  ): Promise<CompareAndSetInboxV2ConversationResult>;
  withTimelineSequenceAllocation<TResult>(
    input: AllocateInboxV2TimelineRangeInput,
    persist: (context: {
      allocation: InboxV2TimelineRangeAllocation;
      executor: RawSqlExecutor;
    }) => Promise<TResult>
  ): Promise<AllocateInboxV2TimelineRangeResult<TResult>>;
}>;

type InboxV2ConversationAggregateRow = {
  conversation_tenant_id: unknown;
  conversation_id: unknown;
  topology: unknown;
  transport: unknown;
  purpose_id: unknown;
  lifecycle: unknown;
  entity_revision: unknown;
  entity_last_changed_stream_position: unknown;
  conversation_created_at: unknown;
  conversation_updated_at: unknown;
  latest_timeline_sequence: unknown;
  latest_activity_item_id: unknown;
  latest_activity_timeline_sequence: unknown;
  latest_activity_at: unknown;
  head_revision: unknown;
  head_last_changed_stream_position: unknown;
  head_created_at: unknown;
  head_updated_at: unknown;
};

type InsertedConversationRow = {
  id: unknown;
};

export class InboxV2PersistenceInvariantError extends Error {
  readonly code = "inbox_v2.persistence_invariant" as const;

  constructor(message: string) {
    super(message);
    this.name = "InboxV2PersistenceInvariantError";
  }
}

export function createSqlInboxV2ConversationRepository(
  executor: InboxV2ConversationTransactionExecutor | HuleeDatabase
): InboxV2ConversationRepository {
  const transactionExecutor =
    executor as unknown as InboxV2ConversationTransactionExecutor;

  return {
    async create(
      input: CreateInboxV2ConversationInput
    ): Promise<CreateInboxV2ConversationResult> {
      const normalized = normalizeCreateInput(input);

      return transactionExecutor.transaction(async (transaction) => {
        const insertResult = await transaction.execute<InsertedConversationRow>(
          buildInsertInboxV2ConversationSql(normalized)
        );
        const created = insertResult.rows.length === 1;

        if (created) {
          await transaction.execute(
            buildInsertInboxV2ConversationHeadSql(normalized)
          );
          await transaction.execute(
            buildInsertInboxV2ConversationMembershipHeadSql(normalized)
          );
        }

        const record = await loadConversationRecord(transaction, {
          tenantId: normalized.tenantId,
          conversationId: normalized.conversationId,
          lock: true
        });

        if (record === null) {
          throw invariantError(
            "Conversation create did not produce a complete Conversation/Head aggregate."
          );
        }

        if (created) {
          return { kind: "created", record };
        }

        return {
          kind: hasSameConversationIdentity(record.aggregate, normalized)
            ? "already_exists"
            : "identity_conflict",
          record
        };
      });
    },

    async findById(
      input
    ): Promise<InboxV2ConversationPersistenceRecord | null> {
      const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
      const conversationId = inboxV2ConversationIdSchema.parse(
        input.conversationId
      );

      return loadConversationRecord(transactionExecutor, {
        tenantId,
        conversationId,
        lock: false
      });
    },

    async compareAndSet(
      input: CompareAndSetInboxV2ConversationInput
    ): Promise<CompareAndSetInboxV2ConversationResult> {
      const normalized = normalizeConversationCasInput(input);

      return transactionExecutor.transaction(async (transaction) => {
        const current = await loadConversationRecord(transaction, {
          tenantId: normalized.tenantId,
          conversationId: normalized.conversationId,
          lock: true
        });

        if (current === null) {
          return { kind: "not_found" };
        }

        if (current.aggregate.revision !== normalized.expectedRevision) {
          return { kind: "revision_conflict", record: current };
        }

        if (hasSameConversationFields(current.aggregate, normalized.next)) {
          return { kind: "no_op", record: current };
        }

        if (current.aggregate.transport !== normalized.next.transport) {
          throw new CoreError(
            "validation.failed",
            "Conversation transport classification is immutable."
          );
        }

        assertForwardMutationMetadata({
          currentPosition: current.entityLastChangedStreamPosition,
          nextPosition: normalized.streamPosition,
          currentUpdatedAt: current.aggregate.updatedAt,
          nextUpdatedAt: normalized.changedAt
        });

        const updateResult = await transaction.execute<InsertedConversationRow>(
          buildCompareAndSetInboxV2ConversationSql(normalized)
        );

        if (updateResult.rows.length !== 1) {
          throw invariantError(
            "Locked Conversation CAS failed its defensive revision predicate."
          );
        }

        const record = await loadConversationRecord(transaction, {
          tenantId: normalized.tenantId,
          conversationId: normalized.conversationId,
          lock: false
        });

        if (record === null) {
          throw invariantError(
            "Conversation disappeared after a successful CAS."
          );
        }

        return { kind: "updated", record };
      });
    },

    async withTimelineSequenceAllocation<TResult>(
      input: AllocateInboxV2TimelineRangeInput,
      persist: (context: {
        allocation: InboxV2TimelineRangeAllocation;
        executor: RawSqlExecutor;
      }) => Promise<TResult>
    ): Promise<AllocateInboxV2TimelineRangeResult<TResult>> {
      const normalized = normalizeTimelineAllocationInput(input);

      return transactionExecutor.transaction(async (transaction) => {
        const current = await loadConversationRecord(transaction, {
          tenantId: normalized.tenantId,
          conversationId: normalized.conversationId,
          lock: true
        });

        if (current === null) {
          return { kind: "not_found" };
        }

        if (
          current.aggregate.head.revision !== normalized.expectedHeadRevision
        ) {
          return { kind: "revision_conflict", record: current };
        }

        assertForwardMutationMetadata({
          currentPosition: current.headLastChangedStreamPosition,
          nextPosition: normalized.streamPosition,
          currentUpdatedAt: current.aggregate.head.updatedAt,
          nextUpdatedAt: normalized.changedAt
        });

        const allocation = allocateTimelineRange(
          current.aggregate.head.latestTimelineSequence,
          normalized.items
        );
        const lastEligibleItem = findLastEligibleItem(
          normalized.items,
          allocation.assignments
        );

        const updateResult = await transaction.execute<InsertedConversationRow>(
          buildCompareAndSetInboxV2ConversationHeadSql({
            ...normalized,
            expectedLatestTimelineSequence:
              current.aggregate.head.latestTimelineSequence,
            latestTimelineSequence: allocation.lastSequence,
            latestActivityItemId:
              lastEligibleItem?.itemId ??
              current.aggregate.head.latestActivityItemId,
            latestActivityTimelineSequence:
              lastEligibleItem?.timelineSequence ??
              current.aggregate.head.latestActivityTimelineSequence,
            latestActivityAt:
              lastEligibleItem?.occurredAt ??
              current.aggregate.head.latestActivityAt
          })
        );

        if (updateResult.rows.length !== 1) {
          throw invariantError(
            "Locked ConversationHead CAS failed its defensive revision/sequence predicate."
          );
        }

        const result = await persist({ allocation, executor: transaction });
        const record = await loadConversationRecord(transaction, {
          tenantId: normalized.tenantId,
          conversationId: normalized.conversationId,
          lock: false
        });

        if (record === null) {
          throw invariantError(
            "Conversation aggregate disappeared after timeline allocation."
          );
        }

        return { kind: "allocated", allocation, record, result };
      });
    }
  };
}

export function buildInsertInboxV2ConversationSql(
  input: CreateInboxV2ConversationInput & {
    lifecycle: InboxV2ConversationLifecycle;
  }
): SQL {
  return sql`
    insert into inbox_v2_conversations (
      tenant_id,
      id,
      topology,
      transport,
      purpose_id,
      lifecycle,
      revision,
      last_changed_stream_position,
      created_at,
      updated_at
    )
    values (
      ${input.tenantId},
      ${input.conversationId},
      ${input.topology},
      ${input.transport},
      ${input.purposeId},
      ${input.lifecycle},
      1,
      ${input.streamPosition},
      ${input.createdAt},
      ${input.createdAt}
    )
    on conflict (tenant_id, id) do nothing
    returning id
  `;
}

export function buildInsertInboxV2ConversationHeadSql(
  input: CreateInboxV2ConversationInput
): SQL {
  return sql`
    insert into inbox_v2_conversation_heads (
      tenant_id,
      conversation_id,
      latest_timeline_sequence,
      latest_activity_item_id,
      latest_activity_timeline_sequence,
      latest_activity_at,
      revision,
      last_changed_stream_position,
      created_at,
      updated_at
    )
    values (
      ${input.tenantId},
      ${input.conversationId},
      0,
      null,
      null,
      null,
      1,
      ${input.streamPosition},
      ${input.createdAt},
      ${input.createdAt}
    )
    returning conversation_id as id
  `;
}

export function buildInsertInboxV2ConversationMembershipHeadSql(
  input: Pick<
    CreateInboxV2ConversationInput,
    "tenantId" | "conversationId" | "createdAt"
  >
): SQL {
  return sql`
    insert into inbox_v2_conversation_membership_heads (
      tenant_id,
      conversation_id,
      membership_revision,
      created_at,
      updated_at
    )
    values (
      ${input.tenantId},
      ${input.conversationId},
      0,
      ${input.createdAt},
      ${input.createdAt}
    )
    returning conversation_id as id
  `;
}

export function buildFindInboxV2ConversationSql(input: {
  tenantId: InboxV2TenantId;
  conversationId: InboxV2ConversationId;
  lockHead?: boolean;
}): SQL {
  const lockClause = input.lockHead ? sql`for update of h` : sql``;

  return sql`
    select
      c.tenant_id as conversation_tenant_id,
      c.id as conversation_id,
      c.topology,
      c.transport,
      c.purpose_id,
      c.lifecycle,
      c.revision as entity_revision,
      c.last_changed_stream_position as entity_last_changed_stream_position,
      c.created_at as conversation_created_at,
      c.updated_at as conversation_updated_at,
      h.latest_timeline_sequence,
      h.latest_activity_item_id,
      h.latest_activity_timeline_sequence,
      h.latest_activity_at,
      h.revision as head_revision,
      h.last_changed_stream_position as head_last_changed_stream_position,
      h.created_at as head_created_at,
      h.updated_at as head_updated_at
    from inbox_v2_conversations c
    inner join inbox_v2_conversation_heads h
      on h.tenant_id = c.tenant_id
     and h.conversation_id = c.id
    where c.tenant_id = ${input.tenantId}
      and c.id = ${input.conversationId}
    ${lockClause}
  `;
}

export function buildLockInboxV2ConversationSql(input: {
  tenantId: InboxV2TenantId;
  conversationId: InboxV2ConversationId;
}): SQL {
  return sql`
    select id
    from inbox_v2_conversations
    where tenant_id = ${input.tenantId}
      and id = ${input.conversationId}
    for update
  `;
}

export function buildCompareAndSetInboxV2ConversationSql(
  input: CompareAndSetInboxV2ConversationInput
): SQL {
  return sql`
    update inbox_v2_conversations
    set topology = ${input.next.topology},
        purpose_id = ${input.next.purposeId},
        lifecycle = ${input.next.lifecycle},
        revision = revision + 1,
        last_changed_stream_position = ${input.streamPosition},
        updated_at = ${input.changedAt}
    where tenant_id = ${input.tenantId}
      and id = ${input.conversationId}
      and revision = ${input.expectedRevision}
    returning id
  `;
}

export function buildCompareAndSetInboxV2ConversationHeadSql(input: {
  tenantId: InboxV2TenantId;
  conversationId: InboxV2ConversationId;
  expectedHeadRevision: InboxV2EntityRevision;
  expectedLatestTimelineSequence: string;
  latestTimelineSequence: InboxV2TimelineSequence;
  latestActivityItemId: InboxV2TimelineItemId | null;
  latestActivityTimelineSequence: string | null;
  latestActivityAt: string | null;
  streamPosition: InboxV2BigintCounter;
  changedAt: string;
}): SQL {
  return sql`
    update inbox_v2_conversation_heads
    set latest_timeline_sequence = ${input.latestTimelineSequence},
        latest_activity_item_id = ${input.latestActivityItemId},
        latest_activity_timeline_sequence = ${input.latestActivityTimelineSequence},
        latest_activity_at = ${input.latestActivityAt},
        revision = revision + 1,
        last_changed_stream_position = ${input.streamPosition},
        updated_at = ${input.changedAt}
    where tenant_id = ${input.tenantId}
      and conversation_id = ${input.conversationId}
      and revision = ${input.expectedHeadRevision}
      and latest_timeline_sequence = ${input.expectedLatestTimelineSequence}
    returning conversation_id as id
  `;
}

async function loadConversationRecord(
  executor: RawSqlExecutor,
  input: {
    tenantId: InboxV2TenantId;
    conversationId: InboxV2ConversationId;
    lock: boolean;
  }
): Promise<InboxV2ConversationPersistenceRecord | null> {
  if (input.lock) {
    const lockedConversation = await executor.execute<InsertedConversationRow>(
      buildLockInboxV2ConversationSql(input)
    );

    if (lockedConversation.rows.length === 0) {
      return null;
    }
    if (lockedConversation.rows.length !== 1) {
      throw invariantError(
        "Tenant-scoped Conversation lock returned more than one row."
      );
    }
  }

  const result = await executor.execute<InboxV2ConversationAggregateRow>(
    buildFindInboxV2ConversationSql({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      lockHead: input.lock
    })
  );

  if (result.rows.length === 0) {
    return null;
  }
  if (result.rows.length !== 1) {
    throw invariantError(
      "Tenant-scoped Conversation lookup returned more than one aggregate."
    );
  }

  return mapConversationAggregateRow(result.rows[0], input.tenantId);
}

function mapConversationAggregateRow(
  row: InboxV2ConversationAggregateRow,
  expectedTenantId: InboxV2TenantId
): InboxV2ConversationPersistenceRecord {
  const tenantId = inboxV2TenantIdSchema.parse(row.conversation_tenant_id);

  if (tenantId !== expectedTenantId) {
    throw new CoreError("tenant.boundary_violation");
  }

  const aggregate = inboxV2ConversationSchema.parse({
    tenantId,
    id: row.conversation_id,
    topology: row.topology,
    transport: row.transport,
    purposeId: row.purpose_id,
    lifecycle: row.lifecycle,
    revision: parseDatabaseBigint(row.entity_revision, "entity revision"),
    createdAt: parseDatabaseTimestamp(
      row.conversation_created_at,
      "Conversation createdAt"
    ),
    updatedAt: parseDatabaseTimestamp(
      row.conversation_updated_at,
      "Conversation updatedAt"
    ),
    head: {
      latestTimelineSequence: parseDatabaseBigint(
        row.latest_timeline_sequence,
        "latest timeline sequence"
      ),
      latestActivityItemId: row.latest_activity_item_id,
      latestActivityTimelineSequence:
        row.latest_activity_timeline_sequence === null
          ? null
          : parseDatabaseBigint(
              row.latest_activity_timeline_sequence,
              "latest activity timeline sequence"
            ),
      latestActivityAt:
        row.latest_activity_at === null
          ? null
          : parseDatabaseTimestamp(
              row.latest_activity_at,
              "latest activity timestamp"
            ),
      revision: parseDatabaseBigint(row.head_revision, "head revision"),
      createdAt: parseDatabaseTimestamp(
        row.head_created_at,
        "ConversationHead createdAt"
      ),
      updatedAt: parseDatabaseTimestamp(
        row.head_updated_at,
        "ConversationHead updatedAt"
      )
    }
  });

  return Object.freeze({
    aggregate,
    entityLastChangedStreamPosition: inboxV2BigintCounterSchema.parse(
      parseDatabaseBigint(
        row.entity_last_changed_stream_position,
        "entity last changed stream position"
      )
    ),
    headLastChangedStreamPosition: inboxV2BigintCounterSchema.parse(
      parseDatabaseBigint(
        row.head_last_changed_stream_position,
        "head last changed stream position"
      )
    )
  });
}

function normalizeCreateInput(
  input: CreateInboxV2ConversationInput
): CreateInboxV2ConversationInput & {
  lifecycle: InboxV2ConversationLifecycle;
} {
  return {
    tenantId: inboxV2TenantIdSchema.parse(input.tenantId),
    conversationId: inboxV2ConversationIdSchema.parse(input.conversationId),
    topology: inboxV2ConversationTopologySchema.parse(input.topology),
    transport: inboxV2ConversationTransportSchema.parse(input.transport),
    purposeId: inboxV2ConversationPurposeIdSchema.parse(input.purposeId),
    lifecycle: inboxV2ConversationLifecycleSchema.parse(
      input.lifecycle ?? "active"
    ),
    streamPosition: parsePositiveStreamPosition(input.streamPosition),
    createdAt: inboxV2TimestampSchema.parse(input.createdAt)
  };
}

function normalizeConversationCasInput(
  input: CompareAndSetInboxV2ConversationInput
): CompareAndSetInboxV2ConversationInput {
  return {
    tenantId: inboxV2TenantIdSchema.parse(input.tenantId),
    conversationId: inboxV2ConversationIdSchema.parse(input.conversationId),
    expectedRevision: inboxV2EntityRevisionSchema.parse(input.expectedRevision),
    next: {
      topology: inboxV2ConversationTopologySchema.parse(input.next.topology),
      transport: inboxV2ConversationTransportSchema.parse(input.next.transport),
      purposeId: inboxV2ConversationPurposeIdSchema.parse(input.next.purposeId),
      lifecycle: inboxV2ConversationLifecycleSchema.parse(input.next.lifecycle)
    },
    streamPosition: parsePositiveStreamPosition(input.streamPosition),
    changedAt: inboxV2TimestampSchema.parse(input.changedAt)
  };
}

function normalizeTimelineAllocationInput(
  input: AllocateInboxV2TimelineRangeInput
): AllocateInboxV2TimelineRangeInput {
  if (
    input.items.length < 1 ||
    input.items.length > MAX_TIMELINE_ALLOCATION_SIZE
  ) {
    throw new CoreError(
      "validation.failed",
      `Timeline allocation size must be between 1 and ${MAX_TIMELINE_ALLOCATION_SIZE}.`
    );
  }

  const itemIds = new Set<string>();
  const items = input.items.map((item) => {
    const itemId = inboxV2TimelineItemIdSchema.parse(item.itemId);

    if (itemIds.has(itemId)) {
      throw new CoreError(
        "validation.failed",
        "Timeline allocation item IDs must be unique within one range."
      );
    }
    itemIds.add(itemId);

    return {
      itemId,
      occurredAt: inboxV2TimestampSchema.parse(item.occurredAt),
      activityEligible: item.activityEligible
    };
  });

  return {
    tenantId: inboxV2TenantIdSchema.parse(input.tenantId),
    conversationId: inboxV2ConversationIdSchema.parse(input.conversationId),
    expectedHeadRevision: inboxV2EntityRevisionSchema.parse(
      input.expectedHeadRevision
    ),
    items,
    streamPosition: parsePositiveStreamPosition(input.streamPosition),
    changedAt: inboxV2TimestampSchema.parse(input.changedAt)
  };
}

function allocateTimelineRange(
  latestSequence: string,
  items: readonly InboxV2TimelineAllocationItem[]
): InboxV2TimelineRangeAllocation {
  const first = BigInt(latestSequence) + 1n;
  const last = BigInt(latestSequence) + BigInt(items.length);

  if (last > POSTGRES_BIGINT_MAX) {
    throw new CoreError(
      "validation.failed",
      "Timeline allocation exceeds the PostgreSQL bigint range."
    );
  }

  const assignments = items.map((item, index) =>
    Object.freeze({
      itemId: item.itemId,
      timelineSequence: inboxV2TimelineSequenceSchema.parse(
        String(first + BigInt(index))
      )
    })
  );

  return Object.freeze({
    firstSequence: inboxV2TimelineSequenceSchema.parse(String(first)),
    lastSequence: inboxV2TimelineSequenceSchema.parse(String(last)),
    assignments: Object.freeze(assignments)
  });
}

function findLastEligibleItem(
  items: readonly InboxV2TimelineAllocationItem[],
  assignments: readonly InboxV2TimelineSequenceAssignment[]
):
  | (InboxV2TimelineAllocationItem & {
      timelineSequence: InboxV2TimelineSequence;
    })
  | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    const assignment = assignments[index];

    if (item?.activityEligible && assignment) {
      return { ...item, timelineSequence: assignment.timelineSequence };
    }
  }

  return null;
}

function hasSameConversationFields(
  conversation: InboxV2Conversation,
  next: CompareAndSetInboxV2ConversationInput["next"]
): boolean {
  return (
    conversation.topology === next.topology &&
    conversation.transport === next.transport &&
    conversation.purposeId === next.purposeId &&
    conversation.lifecycle === next.lifecycle
  );
}

function hasSameConversationIdentity(
  conversation: InboxV2Conversation,
  requested: Pick<
    CreateInboxV2ConversationInput,
    "topology" | "transport" | "purposeId"
  >
): boolean {
  return (
    conversation.topology === requested.topology &&
    conversation.transport === requested.transport &&
    conversation.purposeId === requested.purposeId
  );
}

function assertForwardMutationMetadata(input: {
  currentPosition: InboxV2BigintCounter;
  nextPosition: InboxV2BigintCounter;
  currentUpdatedAt: string;
  nextUpdatedAt: string;
}): void {
  if (BigInt(input.nextPosition) <= BigInt(input.currentPosition)) {
    throw new CoreError(
      "validation.failed",
      "A committed mutation must advance its last changed stream position."
    );
  }
  if (Date.parse(input.nextUpdatedAt) < Date.parse(input.currentUpdatedAt)) {
    throw new CoreError(
      "validation.failed",
      "A committed mutation cannot move its updatedAt backwards."
    );
  }
}

function parsePositiveStreamPosition(value: unknown): InboxV2BigintCounter {
  const parsed = inboxV2BigintCounterSchema.parse(value);

  if (parsed === "0") {
    throw new CoreError(
      "validation.failed",
      "Persisted Inbox V2 state requires a positive tenant stream position."
    );
  }

  return parsed;
}

function parseDatabaseBigint(value: unknown, field: string): string {
  if (typeof value === "number") {
    throw invariantError(
      `${field} was decoded as a JavaScript number and may have lost precision.`
    );
  }
  if (typeof value !== "string" && typeof value !== "bigint") {
    throw invariantError(`${field} is not a PostgreSQL bigint value.`);
  }

  return String(value);
}

function parseDatabaseTimestamp(value: unknown, field: string): string {
  const parsedTimestamp =
    value instanceof Date
      ? value
      : typeof value === "string"
        ? new Date(value)
        : null;

  if (parsedTimestamp === null || Number.isNaN(parsedTimestamp.getTime())) {
    throw invariantError(`${field} is not a PostgreSQL timestamp.`);
  }

  const normalized = parsedTimestamp.toISOString();
  const parsed = inboxV2TimestampSchema.safeParse(normalized);

  if (!parsed.success) {
    throw invariantError(`${field} is not a canonical timestamp.`);
  }

  return parsed.data;
}

function invariantError(message: string): InboxV2PersistenceInvariantError {
  return new InboxV2PersistenceInvariantError(message);
}

export type { RawSqlExecutor, RawSqlQueryResult };
