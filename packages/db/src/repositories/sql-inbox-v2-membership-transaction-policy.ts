import {
  inboxV2BigintCounterSchema,
  inboxV2ConversationIdSchema,
  inboxV2TenantIdSchema,
  type InboxV2BigintCounter,
  type InboxV2ConversationId,
  type InboxV2TenantId
} from "@hulee/contracts";
import { CoreError } from "@hulee/core";
import { sql, type SQL } from "drizzle-orm";

import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";

export const INBOX_V2_MEMBERSHIP_TRANSACTION_CONFIG = {
  isolationLevel: "read committed"
} as const;

export const INBOX_V2_MEMBERSHIP_TRANSACTION_MAX_ATTEMPTS = 3;

const RETRYABLE_MEMBERSHIP_SQLSTATES = new Set(["40001", "40P01"]);

export type InboxV2MembershipTransactionExecutor = RawSqlExecutor & {
  transaction<TResult>(
    work: (transaction: RawSqlExecutor) => Promise<TResult>,
    config: Readonly<{ isolationLevel: "read committed" }>
  ): Promise<TResult>;
};

export type InboxV2MembershipTransactionMode = "retry_safe" | "single_attempt";

export type InboxV2MembershipConversationKey = Readonly<{
  tenantId: InboxV2TenantId;
  conversationId: InboxV2ConversationId;
}>;

export type InboxV2MembershipRepairContext = Readonly<{
  executor: RawSqlExecutor;
  conversation: InboxV2MembershipConversationKey;
  currentMembershipRevision: InboxV2BigintCounter;
}>;

export type InboxV2MembershipRepairResult<TResult> =
  | Readonly<{
      kind: "repaired";
      conversation: InboxV2MembershipConversationKey;
      result: TResult;
    }>
  | Readonly<{
      kind: "conversation_not_found";
      conversation: InboxV2MembershipConversationKey;
    }>;

export type PrivilegedInboxV2MembershipRepairRunner = Readonly<{
  /**
   * Runs DB-only repair after taking the Conversation membership head first.
   *
   * The callback can be replayed after PostgreSQL 40001/40P01. It must not
   * perform provider calls or any other externally visible side effect.
   */
  repairConversation<TResult>(
    conversation: InboxV2MembershipConversationKey,
    repair: (context: InboxV2MembershipRepairContext) => Promise<TResult>
  ): Promise<InboxV2MembershipRepairResult<TResult>>;
  /**
   * Sorts exact tenant/Conversation keys and repairs each in its own bounded
   * transaction. A callback never receives more than one Conversation.
   */
  repairConversations<TResult>(
    conversations: readonly InboxV2MembershipConversationKey[],
    repair: (context: InboxV2MembershipRepairContext) => Promise<TResult>
  ): Promise<readonly InboxV2MembershipRepairResult<TResult>[]>;
}>;

type MembershipHeadRow = Readonly<{ membership_revision: unknown }>;

export async function runInboxV2MembershipTransaction<TResult>(
  executor: InboxV2MembershipTransactionExecutor,
  work: (transaction: RawSqlExecutor) => Promise<TResult>,
  mode: InboxV2MembershipTransactionMode = "retry_safe"
): Promise<TResult> {
  const attempts =
    mode === "single_attempt"
      ? 1
      : INBOX_V2_MEMBERSHIP_TRANSACTION_MAX_ATTEMPTS;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await executor.transaction(
        work,
        INBOX_V2_MEMBERSHIP_TRANSACTION_CONFIG
      );
    } catch (error) {
      if (attempt === attempts || !isRetryableMembershipSqlState(error)) {
        throw error;
      }
    }
  }

  throw new Error("Inbox V2 membership transaction retry exhausted.");
}

export function createPrivilegedInboxV2MembershipRepairRunner(
  executor: InboxV2MembershipTransactionExecutor
): PrivilegedInboxV2MembershipRepairRunner {
  const repairConversation = async <TResult>(
    input: InboxV2MembershipConversationKey,
    repair: (context: InboxV2MembershipRepairContext) => Promise<TResult>
  ): Promise<InboxV2MembershipRepairResult<TResult>> => {
    const conversation = parseConversationKey(input);

    return runInboxV2MembershipTransaction(executor, async (transaction) => {
      const head = singleRow(
        await transaction.execute<MembershipHeadRow>(
          buildLockInboxV2MembershipRepairHeadSql(conversation)
        ),
        "Conversation membership repair head"
      );
      if (head === null || head.membership_revision == null) {
        return { kind: "conversation_not_found", conversation } as const;
      }

      const currentMembershipRevision = inboxV2BigintCounterSchema.parse(
        String(head.membership_revision)
      );
      const result = await repair({
        executor: transaction,
        conversation,
        currentMembershipRevision
      });
      return { kind: "repaired", conversation, result } as const;
    });
  };

  return {
    repairConversation,

    async repairConversations<TResult>(
      conversations: readonly InboxV2MembershipConversationKey[],
      repair: (context: InboxV2MembershipRepairContext) => Promise<TResult>
    ): Promise<readonly InboxV2MembershipRepairResult<TResult>[]> {
      const ordered = orderUniqueMembershipConversationKeys(conversations);
      const results: InboxV2MembershipRepairResult<TResult>[] = [];

      for (const conversation of ordered) {
        results.push(await repairConversation(conversation, repair));
      }

      return results;
    }
  };
}

export function buildLockInboxV2MembershipRepairHeadSql(
  conversation: InboxV2MembershipConversationKey
): SQL {
  return sql`
    select public.inbox_v2_lock_conversation_membership_head_v1(
      ${conversation.tenantId},
      ${conversation.conversationId}
    ) as membership_revision
  `;
}

export function orderUniqueMembershipConversationKeys(
  conversations: readonly InboxV2MembershipConversationKey[]
): readonly InboxV2MembershipConversationKey[] {
  const ordered = conversations.map(parseConversationKey).sort(compareKeys);

  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (
      previous?.tenantId === current?.tenantId &&
      previous.conversationId === current.conversationId
    ) {
      throw new CoreError(
        "validation.failed",
        "Membership repair Conversation keys must be unique."
      );
    }
  }

  return ordered;
}

export function hasPostgresSqlState(
  error: unknown,
  states: ReadonlySet<string>
): boolean {
  let current = error;
  const seen = new Set<unknown>();

  for (let depth = 0; depth < 8; depth += 1) {
    if (
      (typeof current !== "object" || current === null) &&
      typeof current !== "function"
    ) {
      return false;
    }
    if (seen.has(current)) return false;
    seen.add(current);

    const code = Reflect.get(current, "code");
    if (typeof code === "string" && states.has(code)) return true;
    current = Reflect.get(current, "cause");
  }

  return false;
}

export function hasPostgresSqlStateAndMessage(
  error: unknown,
  state: string,
  message: string
): boolean {
  let current = error;
  const seen = new Set<unknown>();

  for (let depth = 0; depth < 8; depth += 1) {
    if (
      (typeof current !== "object" || current === null) &&
      typeof current !== "function"
    ) {
      return false;
    }
    if (seen.has(current)) return false;
    seen.add(current);

    if (
      Reflect.get(current, "code") === state &&
      Reflect.get(current, "message") === message
    ) {
      return true;
    }
    current = Reflect.get(current, "cause");
  }

  return false;
}

function isRetryableMembershipSqlState(error: unknown): boolean {
  return hasPostgresSqlState(error, RETRYABLE_MEMBERSHIP_SQLSTATES);
}

function parseConversationKey(
  input: InboxV2MembershipConversationKey
): InboxV2MembershipConversationKey {
  return {
    tenantId: inboxV2TenantIdSchema.parse(input.tenantId),
    conversationId: inboxV2ConversationIdSchema.parse(input.conversationId)
  };
}

function compareKeys(
  left: InboxV2MembershipConversationKey,
  right: InboxV2MembershipConversationKey
): number {
  const tenantOrder = compareStableStrings(left.tenantId, right.tenantId);
  return tenantOrder !== 0
    ? tenantOrder
    : compareStableStrings(left.conversationId, right.conversationId);
}

function compareStableStrings(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function singleRow<TRow>(
  result: RawSqlQueryResult<TRow>,
  label: string
): TRow | null {
  if (result.rows.length > 1) {
    throw new Error(`${label} returned more than one row.`);
  }
  return result.rows[0] ?? null;
}
