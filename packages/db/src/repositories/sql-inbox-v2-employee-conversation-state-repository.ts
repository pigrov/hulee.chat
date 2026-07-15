import {
  inboxV2BigintCounterSchema,
  inboxV2ConversationIdSchema,
  inboxV2EmployeeConversationNotificationLevelSchema,
  inboxV2EmployeeConversationStateSchema,
  inboxV2EmployeeIdSchema,
  inboxV2EntityRevisionSchema,
  inboxV2TenantIdSchema,
  inboxV2TimelineSequenceSchema,
  inboxV2TimestampSchema,
  type InboxV2BigintCounter,
  type InboxV2ConversationId,
  type InboxV2EmployeeConversationNotificationLevel,
  type InboxV2EmployeeConversationState,
  type InboxV2EmployeeId,
  type InboxV2EntityRevision,
  type InboxV2TenantId,
  type InboxV2TimelineSequence
} from "@hulee/contracts";
import { CoreError } from "@hulee/core";
import { sql, type SQL } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";

export type InboxV2EmployeeConversationStatePersistenceRecord = Readonly<{
  state: InboxV2EmployeeConversationState;
  lastChangedStreamPosition: InboxV2BigintCounter;
}>;

export type MarkInboxV2EmployeeConversationReadInput = Readonly<{
  tenantId: InboxV2TenantId;
  employeeId: InboxV2EmployeeId;
  conversationId: InboxV2ConversationId;
  sequence: InboxV2TimelineSequence;
  changedAt: string;
}>;

export type InboxV2EmployeeConversationPreferencePatch = Readonly<{
  manualUnread?: boolean;
  muted?: boolean;
  notificationLevel?: InboxV2EmployeeConversationNotificationLevel;
  pinned?: boolean;
  archived?: boolean;
}>;

export type CompareAndSetInboxV2EmployeeConversationPreferencesInput =
  Readonly<{
    tenantId: InboxV2TenantId;
    employeeId: InboxV2EmployeeId;
    conversationId: InboxV2ConversationId;
    expectedRevision: InboxV2EntityRevision | null;
    patch: InboxV2EmployeeConversationPreferencePatch;
    changedAt: string;
  }>;

export type CommitInboxV2EmployeeConversationStateResult<TResult> = Readonly<{
  streamPosition: InboxV2BigintCounter;
  result: TResult;
}>;

export type CommitInboxV2EmployeeConversationRead<TResult> = (context: {
  executor: RawSqlExecutor;
  current: InboxV2EmployeeConversationStatePersistenceRecord | null;
  requestedSequence: InboxV2TimelineSequence;
  resultingRevision: InboxV2EntityRevision;
  changedAt: string;
}) => Promise<CommitInboxV2EmployeeConversationStateResult<TResult>>;

export type CommitInboxV2EmployeeConversationPreferences<TResult> = (context: {
  executor: RawSqlExecutor;
  current: InboxV2EmployeeConversationStatePersistenceRecord | null;
  patch: InboxV2EmployeeConversationPreferencePatch;
  resultingRevision: InboxV2EntityRevision;
  changedAt: string;
}) => Promise<CommitInboxV2EmployeeConversationStateResult<TResult>>;

export type MarkInboxV2EmployeeConversationReadResult<TResult> =
  | Readonly<{
      kind: "advanced";
      record: InboxV2EmployeeConversationStatePersistenceRecord;
      result: TResult;
    }>
  | Readonly<{
      kind: "already_applied";
      record: InboxV2EmployeeConversationStatePersistenceRecord;
    }>
  | Readonly<{ kind: "not_found" }>;

export type CompareAndSetInboxV2EmployeeConversationPreferencesResult<TResult> =
  | Readonly<{
      kind: "updated";
      record: InboxV2EmployeeConversationStatePersistenceRecord;
      result: TResult;
    }>
  | Readonly<{
      kind: "already_applied";
      record: InboxV2EmployeeConversationStatePersistenceRecord | null;
    }>
  | Readonly<{
      kind: "revision_conflict";
      record: InboxV2EmployeeConversationStatePersistenceRecord;
    }>
  | Readonly<{ kind: "not_found" }>;

export type InboxV2EmployeeConversationStateTransactionExecutor =
  RawSqlExecutor & {
    transaction<TResult>(
      work: (transaction: RawSqlExecutor) => Promise<TResult>
    ): Promise<TResult>;
  };

export type InboxV2EmployeeConversationStateRepository = Readonly<{
  find(input: {
    tenantId: InboxV2TenantId;
    employeeId: InboxV2EmployeeId;
    conversationId: InboxV2ConversationId;
  }): Promise<InboxV2EmployeeConversationStatePersistenceRecord | null>;
  markReadThrough<TResult>(
    input: MarkInboxV2EmployeeConversationReadInput,
    commit: CommitInboxV2EmployeeConversationRead<TResult>
  ): Promise<MarkInboxV2EmployeeConversationReadResult<TResult>>;
  compareAndSetPreferences<TResult>(
    input: CompareAndSetInboxV2EmployeeConversationPreferencesInput,
    commit: CommitInboxV2EmployeeConversationPreferences<TResult>
  ): Promise<
    CompareAndSetInboxV2EmployeeConversationPreferencesResult<TResult>
  >;
}>;

type StateKey = Readonly<{
  tenantId: InboxV2TenantId;
  employeeId: InboxV2EmployeeId;
  conversationId: InboxV2ConversationId;
}>;

type StateRow = {
  tenant_id: unknown;
  employee_id: unknown;
  conversation_id: unknown;
  last_read_sequence: unknown;
  last_read_at: unknown;
  manual_unread: unknown;
  manual_unread_changed_at: unknown;
  muted: unknown;
  mute_changed_at: unknown;
  notification_level: unknown;
  notification_level_changed_at: unknown;
  pinned: unknown;
  pin_changed_at: unknown;
  archived: unknown;
  archive_changed_at: unknown;
  revision: unknown;
  last_changed_stream_position: unknown;
  created_at: unknown;
  updated_at: unknown;
};

type FoundRow = { found: unknown };

type PreferenceValues = Readonly<{
  manualUnread: boolean;
  muted: boolean;
  notificationLevel: InboxV2EmployeeConversationNotificationLevel;
  pinned: boolean;
  archived: boolean;
}>;

type InsertStateValues = StateKey &
  PreferenceValues &
  Readonly<{
    lastReadSequence: string;
    lastReadAt: string | null;
    revision: InboxV2EntityRevision;
    streamPosition: InboxV2BigintCounter;
    changedAt: string;
  }>;

const DEFAULT_PREFERENCES: PreferenceValues = Object.freeze({
  manualUnread: false,
  muted: false,
  notificationLevel: "inherit",
  pinned: false,
  archived: false
});

const PREFERENCE_FIELDS = [
  "manualUnread",
  "muted",
  "notificationLevel",
  "pinned",
  "archived"
] as const;

export class InboxV2EmployeeConversationStatePersistenceInvariantError extends Error {
  readonly code = "inbox_v2.employee_conversation_state_invariant" as const;

  constructor(message: string) {
    super(message);
    this.name = "InboxV2EmployeeConversationStatePersistenceInvariantError";
  }
}

export function createSqlInboxV2EmployeeConversationStateRepository(
  executor: InboxV2EmployeeConversationStateTransactionExecutor | HuleeDatabase
): InboxV2EmployeeConversationStateRepository {
  const transactionExecutor =
    executor as unknown as InboxV2EmployeeConversationStateTransactionExecutor;

  return {
    async find(input) {
      const key = normalizeStateKey(input);
      return loadState(transactionExecutor, key, false);
    },

    async markReadThrough(input, commit) {
      const normalized = normalizeMarkReadInput(input);

      return transactionExecutor.transaction(async (transaction) => {
        await lockStateKey(transaction, normalized);

        if (!(await exactReadTargetExists(transaction, normalized))) {
          return { kind: "not_found" };
        }

        const current = await loadState(transaction, normalized, true);
        if (
          current !== null &&
          BigInt(normalized.sequence) <= BigInt(current.state.lastReadSequence)
        ) {
          return { kind: "already_applied", record: current };
        }

        assertForwardTimestamp(current, normalized.changedAt);
        const resultingRevision = nextRevision(current);
        const committed = await commit({
          executor: transaction,
          current,
          requestedSequence: normalized.sequence,
          resultingRevision,
          changedAt: normalized.changedAt
        });
        const streamPosition = normalizeCommittedStreamPosition(
          committed.streamPosition,
          current
        );

        const updated =
          current === null
            ? await insertState(transaction, {
                ...normalized,
                ...DEFAULT_PREFERENCES,
                lastReadSequence: normalized.sequence,
                lastReadAt: normalized.changedAt,
                revision: resultingRevision,
                streamPosition,
                changedAt: normalized.changedAt
              })
            : await advanceReadState(transaction, {
                ...normalized,
                expectedRevision: current.state.revision,
                resultingRevision,
                streamPosition
              });

        return { kind: "advanced", record: updated, result: committed.result };
      });
    },

    async compareAndSetPreferences(input, commit) {
      const normalized = normalizePreferenceInput(input);

      return transactionExecutor.transaction(async (transaction) => {
        await lockStateKey(transaction, normalized);

        if (!(await stateParentsExist(transaction, normalized))) {
          return { kind: "not_found" };
        }

        const current = await loadState(transaction, normalized, true);
        const desired = applyPreferencePatch(current, normalized.patch);

        if (hasSamePreferences(current, desired)) {
          return { kind: "already_applied", record: current };
        }

        if (current === null) {
          if (normalized.expectedRevision !== null) {
            return { kind: "not_found" };
          }
        } else if (
          normalized.expectedRevision === null ||
          current.state.revision !== normalized.expectedRevision
        ) {
          return { kind: "revision_conflict", record: current };
        }

        assertForwardTimestamp(current, normalized.changedAt);
        const resultingRevision = nextRevision(current);
        const committed = await commit({
          executor: transaction,
          current,
          patch: normalized.patch,
          resultingRevision,
          changedAt: normalized.changedAt
        });
        const streamPosition = normalizeCommittedStreamPosition(
          committed.streamPosition,
          current
        );

        const updated =
          current === null
            ? await insertState(transaction, {
                ...normalized,
                ...desired,
                lastReadSequence: "0",
                lastReadAt: null,
                revision: resultingRevision,
                streamPosition,
                changedAt: normalized.changedAt
              })
            : await updatePreferences(transaction, {
                ...normalized,
                ...desired,
                expectedRevision: current.state.revision,
                resultingRevision,
                streamPosition
              });

        return { kind: "updated", record: updated, result: committed.result };
      });
    }
  };
}

export function buildLockInboxV2EmployeeConversationStateKeySql(
  input: StateKey
): SQL {
  // PostgreSQL text rejects NUL bytes. JSON gives this tuple an unambiguous,
  // NUL-free encoding before the server hashes it into an advisory-lock key.
  const lockKey = JSON.stringify([
    "inbox-v2-employee-conversation-state",
    input.tenantId,
    input.employeeId,
    input.conversationId
  ]);

  return sql`
    select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0)) as found
  `;
}

export function buildValidateInboxV2EmployeeConversationStateParentsSql(
  input: StateKey
): SQL {
  return sql`
    select true as found
    from employees employee
    inner join inbox_v2_conversations conversation
      on conversation.tenant_id = employee.tenant_id
     and conversation.id = ${input.conversationId}
    where employee.tenant_id = ${input.tenantId}
      and employee.id = ${input.employeeId}
    for key share of employee, conversation
  `;
}

export function buildValidateInboxV2EmployeeConversationReadTargetSql(
  input: StateKey & { sequence: InboxV2TimelineSequence }
): SQL {
  return sql`
    select true as found
    from employees employee
    inner join inbox_v2_conversations conversation
      on conversation.tenant_id = employee.tenant_id
     and conversation.id = ${input.conversationId}
    inner join inbox_v2_timeline_items timeline_item
      on timeline_item.tenant_id = conversation.tenant_id
     and timeline_item.conversation_id = conversation.id
     and timeline_item.conversation_id = ${input.conversationId}
     and timeline_item.timeline_sequence = ${input.sequence}
    where employee.tenant_id = ${input.tenantId}
      and employee.id = ${input.employeeId}
    for key share of employee, conversation, timeline_item
  `;
}

export function buildFindInboxV2EmployeeConversationStateSql(
  input: StateKey & { lock?: boolean }
): SQL {
  const lockClause = input.lock ? sql`for update` : sql``;

  return sql`
    select
      tenant_id,
      employee_id,
      conversation_id,
      last_read_sequence,
      last_read_at,
      manual_unread,
      manual_unread_changed_at,
      muted,
      mute_changed_at,
      notification_level,
      notification_level_changed_at,
      pinned,
      pin_changed_at,
      archived,
      archive_changed_at,
      revision,
      last_changed_stream_position,
      created_at,
      updated_at
    from inbox_v2_employee_conversation_states
    where tenant_id = ${input.tenantId}
      and employee_id = ${input.employeeId}
      and conversation_id = ${input.conversationId}
    ${lockClause}
  `;
}

export function buildInsertInboxV2EmployeeConversationStateSql(
  input: InsertStateValues
): SQL {
  return sql`
    insert into inbox_v2_employee_conversation_states (
      tenant_id,
      employee_id,
      conversation_id,
      last_read_sequence,
      last_read_at,
      manual_unread,
      manual_unread_changed_at,
      muted,
      mute_changed_at,
      notification_level,
      notification_level_changed_at,
      pinned,
      pin_changed_at,
      archived,
      archive_changed_at,
      revision,
      last_changed_stream_position,
      created_at,
      updated_at
    ) values (
      ${input.tenantId},
      ${input.employeeId},
      ${input.conversationId},
      ${input.lastReadSequence},
      ${input.lastReadAt},
      ${input.manualUnread},
      ${input.changedAt},
      ${input.muted},
      ${input.changedAt},
      ${input.notificationLevel},
      ${input.changedAt},
      ${input.pinned},
      ${input.changedAt},
      ${input.archived},
      ${input.changedAt},
      ${input.revision},
      ${input.streamPosition},
      ${input.changedAt},
      ${input.changedAt}
    )
    returning *
  `;
}

export function buildAdvanceInboxV2EmployeeConversationReadSql(
  input: StateKey & {
    sequence: InboxV2TimelineSequence;
    expectedRevision: InboxV2EntityRevision;
    resultingRevision: InboxV2EntityRevision;
    streamPosition: InboxV2BigintCounter;
    changedAt: string;
  }
): SQL {
  return sql`
    update inbox_v2_employee_conversation_states
    set last_read_sequence = greatest(last_read_sequence, ${input.sequence}),
        last_read_at = ${input.changedAt},
        revision = ${input.resultingRevision},
        last_changed_stream_position = ${input.streamPosition},
        updated_at = ${input.changedAt}
    where tenant_id = ${input.tenantId}
      and employee_id = ${input.employeeId}
      and conversation_id = ${input.conversationId}
      and revision = ${input.expectedRevision}
      and last_read_sequence < ${input.sequence}
    returning *
  `;
}

export function buildCompareAndSetInboxV2EmployeeConversationPreferencesSql(
  input: StateKey &
    PreferenceValues & {
      expectedRevision: InboxV2EntityRevision;
      resultingRevision: InboxV2EntityRevision;
      streamPosition: InboxV2BigintCounter;
      changedAt: string;
    }
): SQL {
  return sql`
    update inbox_v2_employee_conversation_states
    set manual_unread_changed_at = case
          when manual_unread is distinct from ${input.manualUnread}
          then ${input.changedAt}
          else manual_unread_changed_at
        end,
        manual_unread = ${input.manualUnread},
        mute_changed_at = case
          when muted is distinct from ${input.muted}
          then ${input.changedAt}
          else mute_changed_at
        end,
        muted = ${input.muted},
        notification_level_changed_at = case
          when notification_level is distinct from ${input.notificationLevel}
          then ${input.changedAt}
          else notification_level_changed_at
        end,
        notification_level = ${input.notificationLevel},
        pin_changed_at = case
          when pinned is distinct from ${input.pinned}
          then ${input.changedAt}
          else pin_changed_at
        end,
        pinned = ${input.pinned},
        archive_changed_at = case
          when archived is distinct from ${input.archived}
          then ${input.changedAt}
          else archive_changed_at
        end,
        archived = ${input.archived},
        revision = ${input.resultingRevision},
        last_changed_stream_position = ${input.streamPosition},
        updated_at = ${input.changedAt}
    where tenant_id = ${input.tenantId}
      and employee_id = ${input.employeeId}
      and conversation_id = ${input.conversationId}
      and revision = ${input.expectedRevision}
    returning *
  `;
}

async function lockStateKey(
  executor: RawSqlExecutor,
  key: StateKey
): Promise<void> {
  await executor.execute(buildLockInboxV2EmployeeConversationStateKeySql(key));
}

async function stateParentsExist(
  executor: RawSqlExecutor,
  key: StateKey
): Promise<boolean> {
  const result = await executor.execute<FoundRow>(
    buildValidateInboxV2EmployeeConversationStateParentsSql(key)
  );
  return assertZeroOrOne(result, "Employee/Conversation parent validation");
}

async function exactReadTargetExists(
  executor: RawSqlExecutor,
  input: StateKey & { sequence: InboxV2TimelineSequence }
): Promise<boolean> {
  const result = await executor.execute<FoundRow>(
    buildValidateInboxV2EmployeeConversationReadTargetSql(input)
  );
  return assertZeroOrOne(
    result,
    "Employee/Conversation read target validation"
  );
}

async function loadState(
  executor: RawSqlExecutor,
  key: StateKey,
  lock: boolean
): Promise<InboxV2EmployeeConversationStatePersistenceRecord | null> {
  const result = await executor.execute<StateRow>(
    buildFindInboxV2EmployeeConversationStateSql({ ...key, lock })
  );

  if (result.rows.length === 0) return null;
  if (result.rows.length !== 1) {
    throw invariantError("Tenant-scoped state lookup returned multiple rows.");
  }

  return mapStateRow(result.rows[0], key.tenantId);
}

async function insertState(
  executor: RawSqlExecutor,
  input: InsertStateValues
): Promise<InboxV2EmployeeConversationStatePersistenceRecord> {
  const result = await executor.execute<StateRow>(
    buildInsertInboxV2EmployeeConversationStateSql(input)
  );
  return mapSingleMutationRow(result, input.tenantId, "insert");
}

async function advanceReadState(
  executor: RawSqlExecutor,
  input: Parameters<typeof buildAdvanceInboxV2EmployeeConversationReadSql>[0]
): Promise<InboxV2EmployeeConversationStatePersistenceRecord> {
  const result = await executor.execute<StateRow>(
    buildAdvanceInboxV2EmployeeConversationReadSql(input)
  );
  return mapSingleMutationRow(result, input.tenantId, "read advancement");
}

async function updatePreferences(
  executor: RawSqlExecutor,
  input: Parameters<
    typeof buildCompareAndSetInboxV2EmployeeConversationPreferencesSql
  >[0]
): Promise<InboxV2EmployeeConversationStatePersistenceRecord> {
  const result = await executor.execute<StateRow>(
    buildCompareAndSetInboxV2EmployeeConversationPreferencesSql(input)
  );
  return mapSingleMutationRow(result, input.tenantId, "preference CAS");
}

function mapSingleMutationRow(
  result: RawSqlQueryResult<StateRow>,
  tenantId: InboxV2TenantId,
  operation: string
): InboxV2EmployeeConversationStatePersistenceRecord {
  if (result.rows.length !== 1) {
    throw invariantError(
      `Locked EmployeeConversationState ${operation} did not return one row.`
    );
  }
  return mapStateRow(result.rows[0], tenantId);
}

function mapStateRow(
  row: StateRow,
  expectedTenantId: InboxV2TenantId
): InboxV2EmployeeConversationStatePersistenceRecord {
  const tenantId = inboxV2TenantIdSchema.parse(row.tenant_id);
  if (tenantId !== expectedTenantId) {
    throw new CoreError("tenant.boundary_violation");
  }

  const state = inboxV2EmployeeConversationStateSchema.parse({
    tenantId,
    employee: {
      tenantId,
      kind: "employee",
      id: row.employee_id
    },
    conversation: {
      tenantId,
      kind: "conversation",
      id: row.conversation_id
    },
    lastReadSequence: parseDatabaseBigint(
      row.last_read_sequence,
      "last-read sequence"
    ),
    lastReadAt: parseOptionalDatabaseTimestamp(
      row.last_read_at,
      "last-read timestamp"
    ),
    manualUnread: row.manual_unread,
    manualUnreadChangedAt: parseDatabaseTimestamp(
      row.manual_unread_changed_at,
      "manual-unread changed timestamp"
    ),
    muted: row.muted,
    muteChangedAt: parseDatabaseTimestamp(
      row.mute_changed_at,
      "mute changed timestamp"
    ),
    notificationLevel: row.notification_level,
    notificationLevelChangedAt: parseDatabaseTimestamp(
      row.notification_level_changed_at,
      "notification-level changed timestamp"
    ),
    pinned: row.pinned,
    pinChangedAt: parseDatabaseTimestamp(
      row.pin_changed_at,
      "pin changed timestamp"
    ),
    archived: row.archived,
    archiveChangedAt: parseDatabaseTimestamp(
      row.archive_changed_at,
      "archive changed timestamp"
    ),
    revision: parseDatabaseBigint(row.revision, "state revision"),
    createdAt: parseDatabaseTimestamp(row.created_at, "state createdAt"),
    updatedAt: parseDatabaseTimestamp(row.updated_at, "state updatedAt")
  });

  return Object.freeze({
    state,
    lastChangedStreamPosition: inboxV2BigintCounterSchema.parse(
      parseDatabaseBigint(
        row.last_changed_stream_position,
        "state last changed stream position"
      )
    )
  });
}

function normalizeStateKey(input: StateKey): StateKey {
  return {
    tenantId: inboxV2TenantIdSchema.parse(input.tenantId),
    employeeId: inboxV2EmployeeIdSchema.parse(input.employeeId),
    conversationId: inboxV2ConversationIdSchema.parse(input.conversationId)
  };
}

function normalizeMarkReadInput(
  input: MarkInboxV2EmployeeConversationReadInput
): MarkInboxV2EmployeeConversationReadInput {
  return {
    ...normalizeStateKey(input),
    sequence: inboxV2TimelineSequenceSchema.parse(input.sequence),
    changedAt: inboxV2TimestampSchema.parse(input.changedAt)
  };
}

function normalizePreferenceInput(
  input: CompareAndSetInboxV2EmployeeConversationPreferencesInput
): CompareAndSetInboxV2EmployeeConversationPreferencesInput {
  const patch = normalizePreferencePatch(input.patch);
  return {
    ...normalizeStateKey(input),
    expectedRevision:
      input.expectedRevision === null
        ? null
        : inboxV2EntityRevisionSchema.parse(input.expectedRevision),
    patch,
    changedAt: inboxV2TimestampSchema.parse(input.changedAt)
  };
}

function normalizePreferencePatch(
  input: InboxV2EmployeeConversationPreferencePatch
): InboxV2EmployeeConversationPreferencePatch {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new CoreError("validation.failed", "Preference patch is required.");
  }

  const inputRecord = input as Readonly<Record<string, unknown>>;
  const keys = Object.keys(inputRecord);
  if (
    keys.length === 0 ||
    keys.some(
      (key) =>
        !PREFERENCE_FIELDS.includes(key as (typeof PREFERENCE_FIELDS)[number])
    )
  ) {
    throw new CoreError(
      "validation.failed",
      "Preference patch must contain only supported non-empty fields."
    );
  }

  const normalized: {
    manualUnread?: boolean;
    muted?: boolean;
    notificationLevel?: InboxV2EmployeeConversationNotificationLevel;
    pinned?: boolean;
    archived?: boolean;
  } = {};
  if ("manualUnread" in inputRecord) {
    normalized.manualUnread = parseBoolean(
      inputRecord.manualUnread,
      "manualUnread"
    );
  }
  if ("muted" in inputRecord) {
    normalized.muted = parseBoolean(inputRecord.muted, "muted");
  }
  if ("notificationLevel" in inputRecord) {
    normalized.notificationLevel =
      inboxV2EmployeeConversationNotificationLevelSchema.parse(
        inputRecord.notificationLevel
      );
  }
  if ("pinned" in inputRecord) {
    normalized.pinned = parseBoolean(inputRecord.pinned, "pinned");
  }
  if ("archived" in inputRecord) {
    normalized.archived = parseBoolean(inputRecord.archived, "archived");
  }
  return Object.freeze(normalized);
}

function applyPreferencePatch(
  current: InboxV2EmployeeConversationStatePersistenceRecord | null,
  patch: InboxV2EmployeeConversationPreferencePatch
): PreferenceValues {
  const base = current?.state ?? DEFAULT_PREFERENCES;
  return {
    manualUnread: patch.manualUnread ?? base.manualUnread,
    muted: patch.muted ?? base.muted,
    notificationLevel: patch.notificationLevel ?? base.notificationLevel,
    pinned: patch.pinned ?? base.pinned,
    archived: patch.archived ?? base.archived
  };
}

function hasSamePreferences(
  current: InboxV2EmployeeConversationStatePersistenceRecord | null,
  desired: PreferenceValues
): boolean {
  const state = current?.state ?? DEFAULT_PREFERENCES;
  return (
    state.manualUnread === desired.manualUnread &&
    state.muted === desired.muted &&
    state.notificationLevel === desired.notificationLevel &&
    state.pinned === desired.pinned &&
    state.archived === desired.archived
  );
}

function nextRevision(
  current: InboxV2EmployeeConversationStatePersistenceRecord | null
): InboxV2EntityRevision {
  return inboxV2EntityRevisionSchema.parse(
    current === null ? "1" : (BigInt(current.state.revision) + 1n).toString()
  );
}

function normalizeCommittedStreamPosition(
  value: InboxV2BigintCounter,
  current: InboxV2EmployeeConversationStatePersistenceRecord | null
): InboxV2BigintCounter {
  const parsed = inboxV2BigintCounterSchema.parse(value);
  if (
    parsed === "0" ||
    (current !== null &&
      BigInt(parsed) <= BigInt(current.lastChangedStreamPosition))
  ) {
    throw new CoreError(
      "validation.failed",
      "A committed personal-state mutation must advance its tenant stream position."
    );
  }
  return parsed;
}

function assertForwardTimestamp(
  current: InboxV2EmployeeConversationStatePersistenceRecord | null,
  changedAt: string
): void {
  if (
    current !== null &&
    Date.parse(changedAt) < Date.parse(current.state.updatedAt)
  ) {
    throw new CoreError(
      "validation.failed",
      "A personal-state mutation cannot move updatedAt backwards."
    );
  }
}

function assertZeroOrOne(
  result: RawSqlQueryResult<FoundRow>,
  operation: string
): boolean {
  if (result.rows.length > 1) {
    throw invariantError(`${operation} returned multiple rows.`);
  }
  return result.rows.length === 1;
}

function parseBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new CoreError("validation.failed", `${field} must be boolean.`);
  }
  return value;
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

function parseOptionalDatabaseTimestamp(
  value: unknown,
  field: string
): string | null {
  return value === null ? null : parseDatabaseTimestamp(value, field);
}

function invariantError(
  message: string
): InboxV2EmployeeConversationStatePersistenceInvariantError {
  return new InboxV2EmployeeConversationStatePersistenceInvariantError(message);
}

export type { RawSqlExecutor, RawSqlQueryResult };
