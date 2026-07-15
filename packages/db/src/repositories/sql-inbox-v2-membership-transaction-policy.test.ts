import type { InboxV2ConversationId, InboxV2TenantId } from "@hulee/contracts";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  createPrivilegedInboxV2MembershipRepairRunner,
  runInboxV2MembershipTransaction,
  type InboxV2MembershipConversationKey,
  type InboxV2MembershipTransactionExecutor
} from "./sql-inbox-v2-membership-transaction-policy";
import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";

describe("Inbox V2 membership transaction policy", () => {
  it("retries only 40001/40P01 up to three READ COMMITTED attempts", async () => {
    const executor = new PolicyExecutor().failNextTransactions(
      Object.assign(new Error("wrapped deadlock"), {
        cause: Object.assign(new Error("deadlock"), { code: "40P01" })
      }),
      Object.assign(new Error("serialization failure"), { code: "40001" })
    );
    let workCalls = 0;

    await expect(
      runInboxV2MembershipTransaction(executor, async () => {
        workCalls += 1;
        return "committed";
      })
    ).resolves.toBe("committed");

    expect(executor.transactionCount).toBe(3);
    expect(executor.isolationLevels).toEqual([
      "read committed",
      "read committed",
      "read committed"
    ]);
    expect(workCalls).toBe(1);

    const terminal = Object.assign(new Error("still deadlocked"), {
      code: "40P01"
    });
    const exhausted = new PolicyExecutor().failNextTransactions(
      terminal,
      terminal,
      terminal
    );

    await expect(
      runInboxV2MembershipTransaction(exhausted, async () => "unreachable")
    ).rejects.toBe(terminal);
    expect(exhausted.transactionCount).toBe(3);
  });

  it("does not retry integrity SQLSTATEs or callback-bearing single attempts", async () => {
    const integrityFailure = Object.assign(new Error("foreign key violation"), {
      code: "23503"
    });
    const nonRetryable = new PolicyExecutor().failNextTransactions(
      integrityFailure
    );

    await expect(
      runInboxV2MembershipTransaction(nonRetryable, async () => "unreachable")
    ).rejects.toBe(integrityFailure);
    expect(nonRetryable.transactionCount).toBe(1);

    const callbackFailure = Object.assign(
      new Error("callback serialization failure"),
      { code: "40001" }
    );
    const callbackExecutor = new PolicyExecutor();
    let callbackCalls = 0;

    await expect(
      runInboxV2MembershipTransaction(
        callbackExecutor,
        async () => {
          callbackCalls += 1;
          throw callbackFailure;
        },
        "single_attempt"
      )
    ).rejects.toBe(callbackFailure);
    expect(callbackCalls).toBe(1);
    expect(callbackExecutor.transactionCount).toBe(1);
    expect(callbackExecutor.isolationLevels).toEqual(["read committed"]);
  });

  it("repairs sorted tenant/Conversation keys one locked transaction at a time", async () => {
    const executor = new PolicyExecutor([
      [{ membership_revision: "2" }],
      [{ membership_revision: "3" }],
      [{ membership_revision: "4" }]
    ]);
    const runner = createPrivilegedInboxV2MembershipRepairRunner(executor);
    const callbackOrder: string[] = [];
    const inputs = [
      conversationKey("tenant:b", "conversation:2"),
      conversationKey("tenant:a", "conversation:9"),
      conversationKey("tenant:a", "conversation:1")
    ];

    const results = await runner.repairConversations(
      inputs,
      async ({ conversation, currentMembershipRevision }) => {
        callbackOrder.push(
          `${conversation.tenantId}/${conversation.conversationId}/${currentMembershipRevision}`
        );
        return conversation.conversationId;
      }
    );

    expect(callbackOrder).toEqual([
      "tenant:a/conversation:1/2",
      "tenant:a/conversation:9/3",
      "tenant:b/conversation:2/4"
    ]);
    expect(results.map((result) => result.kind)).toEqual([
      "repaired",
      "repaired",
      "repaired"
    ]);
    expect(executor.transactionCount).toBe(3);
    expect(executor.isolationLevels).toEqual([
      "read committed",
      "read committed",
      "read committed"
    ]);
    expect(executor.maxConcurrentTransactions).toBe(1);
    expect(
      executor.queries.map(renderQuery).map((query) => query.params)
    ).toEqual([
      ["tenant:a", "conversation:1"],
      ["tenant:a", "conversation:9"],
      ["tenant:b", "conversation:2"]
    ]);
    for (const query of executor.queries.map(renderQuery)) {
      expect(normalizeSql(query.sql)).toContain(
        "public.inbox_v2_lock_conversation_membership_head_v1"
      );
      expect(normalizeSql(query.sql)).not.toContain("for update");
    }
  });

  it("rejects duplicate repair keys before opening a transaction", async () => {
    const executor = new PolicyExecutor();
    const runner = createPrivilegedInboxV2MembershipRepairRunner(executor);
    const key = conversationKey("tenant:a", "conversation:1");

    await expect(
      runner.repairConversations([key, { ...key }], async () => "unused")
    ).rejects.toMatchObject({ code: "validation.failed" });
    expect(executor.transactionCount).toBe(0);
  });
});

class PolicyExecutor implements InboxV2MembershipTransactionExecutor {
  readonly queries: SQL[] = [];
  readonly isolationLevels: string[] = [];
  transactionCount = 0;
  maxConcurrentTransactions = 0;

  private readonly transactionFailures: unknown[] = [];
  private activeTransactions = 0;

  constructor(
    private readonly rows: Array<readonly Record<string, unknown>[]> = []
  ) {}

  failNextTransactions(...errors: unknown[]): this {
    this.transactionFailures.push(...errors);
    return this;
  }

  async execute<Row extends Record<string, unknown>>(
    query: SQL
  ): Promise<RawSqlQueryResult<Row>> {
    this.queries.push(query);
    const rows = this.rows.shift();
    if (rows === undefined) {
      throw new Error("No scripted membership-head row.");
    }
    return { rows: rows as readonly Row[] };
  }

  async transaction<TResult>(
    work: (transaction: RawSqlExecutor) => Promise<TResult>,
    config: Readonly<{ isolationLevel: "read committed" }>
  ): Promise<TResult> {
    this.transactionCount += 1;
    this.isolationLevels.push(config.isolationLevel);
    const failure = this.transactionFailures.shift();
    if (failure !== undefined) throw failure;

    this.activeTransactions += 1;
    this.maxConcurrentTransactions = Math.max(
      this.maxConcurrentTransactions,
      this.activeTransactions
    );
    try {
      return await work(this);
    } finally {
      this.activeTransactions -= 1;
    }
  }
}

function conversationKey(
  tenant: string,
  conversation: string
): InboxV2MembershipConversationKey {
  return {
    tenantId: tenant as InboxV2TenantId,
    conversationId: conversation as InboxV2ConversationId
  };
}

function renderQuery(query: SQL): { sql: string; params: unknown[] } {
  const rendered = new PgDialect().sqlToQuery(query);
  return { sql: rendered.sql, params: [...rendered.params] };
}

function normalizeSql(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}
