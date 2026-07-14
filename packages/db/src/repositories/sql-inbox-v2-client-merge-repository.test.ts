import type {
  InboxV2ClientId,
  InboxV2ClientMergeDecision,
  InboxV2ClientMergeRedirectId,
  InboxV2ClientMergeTrustedServiceId,
  InboxV2TenantId
} from "@hulee/contracts";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { InboxV2PersistenceInvariantError } from "./sql-inbox-v2-conversation-repository";
import {
  buildLockClientMergeRootsSql,
  buildResolveCanonicalClientSql,
  createSqlInboxV2ClientMergeRepository,
  type InboxV2ClientMergeTransactionExecutor,
  type MergeInboxV2ClientRootsInput,
  type RawSqlExecutor,
  type RawSqlQueryResult,
  type ResolveInboxV2CanonicalClientInput
} from "./sql-inbox-v2-client-merge-repository";

const tenantId = "tenant:db-002-client-merge" as InboxV2TenantId;
const sourceClientId = "client:merge-source" as InboxV2ClientId;
const targetClientId = "client:merge-target" as InboxV2ClientId;
const redirectId =
  "client_merge_redirect:merge-1" as InboxV2ClientMergeRedirectId;
const resolverTrustedServiceId =
  "core:client-merge-resolver" as InboxV2ClientMergeTrustedServiceId;
const initialAt = "2026-07-13T16:55:00.000Z";
const headAt = "2026-07-13T17:00:00.000Z";
const resolvedAt = "2026-07-13T17:01:00.000Z";
const createdAt = "2026-07-13T17:02:00.000Z";

describe("SQL Inbox V2 Client merge repository", () => {
  it("uses one bounded recursive snapshot for canonical resolution", async () => {
    const input = resolutionInput();
    const rendered = renderQuery(buildResolveCanonicalClientSql(input));
    const statement = normalizeSql(rendered.sql);

    expect(statement).toContain("with recursive");
    expect(statement).toContain("path.traversal_depth < 64");
    expect(statement).toContain("visited_client_ids");
    expect(statement).toContain("cycle_detected");
    expect(statement).toContain("from graph_head head");
    expect(rendered.params).toEqual([
      tenantId,
      tenantId,
      sourceClientId,
      tenantId,
      sourceClientId
    ]);

    const executor = new ScriptedClientMergeExecutor([
      [
        resolutionRow(redirectedNodeRow(sourceClientId)),
        resolutionRow(mutatedRootNodeRow(targetClientId), {
          traversal_depth: 1
        })
      ]
    ]);
    const result =
      await createSqlInboxV2ClientMergeRepository(executor).resolveCanonical(
        input
      );

    expect(result.kind).toBe("resolved");
    if (result.kind === "resolved") {
      expect(result.resolution.requestedClient.id).toBe(sourceClientId);
      expect(result.resolution.canonicalClient.id).toBe(targetClientId);
      expect(result.resolution.nodes.map((node) => node.client.id)).toEqual([
        sourceClientId,
        targetClientId
      ]);
      expect(result.resolution.graphHead?.revision).toBe("1");
    }
    expect(executor.queries).toHaveLength(1);
    executor.expectExhausted();
  });

  it("locks the head first, then both exact roots in deterministic order and commits exact CAS writes", async () => {
    const input = mergeInput();
    const executor = new ScriptedClientMergeExecutor([
      [emptyHeadRow()],
      [initialNodeRow(sourceClientId), initialNodeRow(targetClientId)],
      [{ id: redirectId }],
      [{ id: sourceClientId }],
      [{ id: targetClientId }],
      [{ id: tenantId }]
    ]);

    const result =
      await createSqlInboxV2ClientMergeRepository(executor).mergeRoots(input);

    expect(result.kind).toBe("merged");
    if (result.kind === "merged") {
      expect(result.commit.redirect.currentGraphRevision).toBeNull();
      expect(result.commit.redirect.resultingGraphRevision).toBe("1");
      expect(result.commit.sourceNodeAfter.state).toBe("redirected");
      expect(result.commit.sourceNodeAfter.nextClient.id).toBe(targetClientId);
      expect(result.commit.targetNodeAfter.maximumInboundDepth).toBe(1);
    }
    expect(executor.transactionIsolationLevels).toEqual(["read committed"]);
    expect(executor.commitCount).toBe(1);

    const statements = executor.normalizedStatements();
    expect(statements[0]).toContain(
      "from public.inbox_v2_client_merge_graph_heads"
    );
    expect(statements[0]).toContain("for update");
    expect(statements[1]).toContain(
      'order by client_id collate "c" for update'
    );
    expect(statements[2]).toContain(
      "insert into public.inbox_v2_client_merge_redirects"
    );
    expect(statements[2]).toContain("on conflict (tenant_id, id) do nothing");
    expect(statements[3]).toContain("last_graph_revision is not distinct from");
    expect(statements[3]).toContain("updated_at =");
    expect(statements[5]).toContain("latest_redirect_id is not distinct from");
    executor.expectExhausted();
  });

  it("returns exact head and alias conflicts without silently canonicalizing or writing", async () => {
    const staleExecutor = new ScriptedClientMergeExecutor([[currentHeadRow()]]);
    const stale =
      await createSqlInboxV2ClientMergeRepository(staleExecutor).mergeRoots(
        mergeInput()
      );
    expect(stale).toEqual({
      kind: "graph_revision_conflict",
      currentGraphRevision: "1"
    });
    expect(staleExecutor.queries).toHaveLength(1);

    const aliasExecutor = new ScriptedClientMergeExecutor([
      [currentHeadRow()],
      [redirectedNodeRow(sourceClientId), mutatedRootNodeRow(targetClientId)]
    ]);
    const alias = await createSqlInboxV2ClientMergeRepository(
      aliasExecutor
    ).mergeRoots(mergeInput({ expectedGraphRevision: "1" as never }));
    expect(alias.kind).toBe("root_conflict");
    if (alias.kind === "root_conflict") {
      expect(alias.sourceNode.state).toBe("redirected");
      expect(alias.targetNode.state).toBe("canonical_root");
    }
    expect(aliasExecutor.queries).toHaveLength(2);
    expect(
      aliasExecutor
        .normalizedStatements()
        .some((statement) => statement.startsWith("insert "))
    ).toBe(false);
  });

  it("retries only serialization/deadlock SQLSTATEs and always keeps READ COMMITTED", async () => {
    const retrying = new ScriptedClientMergeExecutor([
      [currentHeadRow()]
    ]).failNextTransactions(
      Object.assign(new Error("deadlock"), { code: "40P01" }),
      Object.assign(new Error("wrapped"), {
        cause: Object.assign(new Error("serialization"), { code: "40001" })
      })
    );
    const conflict =
      await createSqlInboxV2ClientMergeRepository(retrying).mergeRoots(
        mergeInput()
      );
    expect(conflict.kind).toBe("graph_revision_conflict");
    expect(retrying.transactionCount).toBe(3);
    expect(retrying.transactionIsolationLevels).toEqual([
      "read committed",
      "read committed",
      "read committed"
    ]);

    const nonRetryable = new ScriptedClientMergeExecutor(
      []
    ).failNextTransactions(
      Object.assign(new Error("unique"), { code: "23505" })
    );
    await expect(
      createSqlInboxV2ClientMergeRepository(nonRetryable).mergeRoots(
        mergeInput()
      )
    ).rejects.toThrow("unique");
    expect(nonRetryable.transactionCount).toBe(1);
  });

  it("fails closed on cycles, malformed rows and unsupported public fields", async () => {
    const cyclic = new ScriptedClientMergeExecutor([
      [
        resolutionRow(redirectedNodeRow(sourceClientId), {
          cycle_detected: true
        })
      ]
    ]);
    await expect(
      createSqlInboxV2ClientMergeRepository(cyclic).resolveCanonical(
        resolutionInput()
      )
    ).rejects.toBeInstanceOf(InboxV2PersistenceInvariantError);

    const malformed = new ScriptedClientMergeExecutor([
      [
        resolutionRow(initialNodeRow(sourceClientId), {
          next_client_id: targetClientId
        })
      ]
    ]);
    await expect(
      createSqlInboxV2ClientMergeRepository(malformed).resolveCanonical(
        resolutionInput()
      )
    ).rejects.toBeInstanceOf(InboxV2PersistenceInvariantError);

    const strict = new ScriptedClientMergeExecutor([]);
    await expect(
      createSqlInboxV2ClientMergeRepository(strict).mergeRoots({
        ...mergeInput(),
        unexpected: true
      } as never)
    ).rejects.toThrow(/unsupported fields/u);
    expect(strict.transactionCount).toBe(0);
  });

  it("keeps the deterministic root lock tenant-scoped", () => {
    const rendered = renderQuery(buildLockClientMergeRootsSql(mergeInput()));
    const statement = normalizeSql(rendered.sql);
    expect(statement).toContain("where tenant_id =");
    expect(statement).toContain('order by client_id collate "c" for update');
    expect(rendered.params).toEqual([tenantId, sourceClientId, targetClientId]);
  });
});

class ScriptedClientMergeExecutor implements InboxV2ClientMergeTransactionExecutor {
  readonly queries: SQL[] = [];
  readonly transactionIsolationLevels: string[] = [];
  private readonly transactionFailures: unknown[] = [];
  transactionCount = 0;
  commitCount = 0;
  rollbackCount = 0;

  constructor(
    private readonly steps: Array<readonly Record<string, unknown>[]>
  ) {}

  failNextTransactions(...errors: unknown[]): this {
    this.transactionFailures.push(...errors);
    return this;
  }

  async execute<Row extends Record<string, unknown>>(
    query: SQL
  ): Promise<RawSqlQueryResult<Row>> {
    this.queries.push(query);
    const rows = this.steps.shift();
    if (!rows) {
      throw new Error(
        `Scripted executor has no response for: ${renderQuery(query).sql}`
      );
    }
    return { rows: rows as readonly Row[] };
  }

  async transaction<TResult>(
    work: (transaction: RawSqlExecutor) => Promise<TResult>,
    config: Readonly<{ isolationLevel: "read committed" }>
  ): Promise<TResult> {
    this.transactionCount += 1;
    this.transactionIsolationLevels.push(config.isolationLevel);
    if (this.transactionFailures.length > 0) {
      this.rollbackCount += 1;
      throw this.transactionFailures.shift();
    }
    try {
      const result = await work(this);
      this.commitCount += 1;
      return result;
    } catch (error) {
      this.rollbackCount += 1;
      throw error;
    }
  }

  normalizedStatements(): string[] {
    return this.queries.map((query) => normalizeSql(renderQuery(query).sql));
  }

  expectExhausted(): void {
    expect(this.steps).toHaveLength(0);
  }
}

function resolutionInput(): ResolveInboxV2CanonicalClientInput {
  return {
    tenantId,
    clientId: sourceClientId,
    trustedServiceId: resolverTrustedServiceId,
    resolvedAt
  };
}

function mergeInput(
  overrides: Partial<MergeInboxV2ClientRootsInput> = {}
): MergeInboxV2ClientRootsInput {
  return {
    tenantId,
    redirectId,
    sourceRootClientId: sourceClientId,
    targetRootClientId: targetClientId,
    expectedGraphRevision: null,
    resolverTrustedServiceId,
    resolvedAt,
    decision: mergeDecision(),
    createdAt,
    ...overrides
  };
}

function mergeDecision(): InboxV2ClientMergeDecision {
  return {
    actor: {
      kind: "trusted_service",
      trustedServiceId: resolverTrustedServiceId
    },
    policyId: "core:client-merge-manual" as never,
    policyVersion: "v1" as never,
    reasonCodeId: "core:duplicate-client" as never
  };
}

function emptyHeadRow(): Record<string, unknown> {
  return {
    tenant_id: tenantId,
    revision: null,
    updated_at: null,
    latest_redirect_id: null
  };
}

function currentHeadRow(): Record<string, unknown> {
  return {
    tenant_id: tenantId,
    revision: "1",
    updated_at: headAt,
    latest_redirect_id: redirectId
  };
}

function initialNodeRow(clientId: InboxV2ClientId): Record<string, unknown> {
  return {
    tenant_id: tenantId,
    client_id: clientId,
    state: "canonical_root",
    next_client_id: null,
    redirect_id: null,
    maximum_inbound_depth: 0,
    revision: "1",
    last_graph_revision: null,
    updated_at: initialAt
  };
}

function redirectedNodeRow(clientId: InboxV2ClientId): Record<string, unknown> {
  return {
    tenant_id: tenantId,
    client_id: clientId,
    state: "redirected",
    next_client_id: targetClientId,
    redirect_id: redirectId,
    maximum_inbound_depth: 0,
    revision: "2",
    last_graph_revision: "1",
    updated_at: headAt
  };
}

function mutatedRootNodeRow(
  clientId: InboxV2ClientId
): Record<string, unknown> {
  return {
    tenant_id: tenantId,
    client_id: clientId,
    state: "canonical_root",
    next_client_id: null,
    redirect_id: null,
    maximum_inbound_depth: 1,
    revision: "2",
    last_graph_revision: "1",
    updated_at: headAt
  };
}

function resolutionRow(
  node: Record<string, unknown>,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ...currentHeadRow(),
    client_exists: true,
    node_tenant_id: node.tenant_id,
    client_id: node.client_id,
    state: node.state,
    next_client_id: node.next_client_id,
    redirect_id: node.redirect_id,
    maximum_inbound_depth: node.maximum_inbound_depth,
    node_revision: node.revision,
    last_graph_revision: node.last_graph_revision,
    node_updated_at: node.updated_at,
    traversal_depth: 0,
    cycle_detected: false,
    ...overrides
  };
}

function renderQuery(query: SQL): { sql: string; params: unknown[] } {
  return new PgDialect().sqlToQuery(query);
}

function normalizeSql(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLowerCase();
}
