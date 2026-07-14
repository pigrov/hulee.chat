import {
  inboxV2ActivateTenantPolicyVersionCommandSchema,
  inboxV2ApproveTenantPolicyVersionCommandSchema,
  inboxV2ExactActiveTenantPolicyAuthorityInputSchema,
  inboxV2RevokeTenantPolicyVersionCommandSchema,
  inboxV2TenantPolicyActivationHeadSchema,
  inboxV2TenantPolicyVersionAuthoritySchema,
  type InboxV2TenantPolicyActivationHead,
  type InboxV2TenantPolicyVersionAuthority
} from "@hulee/contracts";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  buildLockExactActiveInboxV2TenantPolicyAuthoritySql,
  createSqlInboxV2TenantPolicyAuthorityRepository,
  lockAndValidateExactActiveInboxV2TenantPolicyAuthority,
  type InboxV2TenantPolicyAuthorityTransactionExecutor,
  type InboxV2TenantPolicyAuthorityUseTransaction,
  type RawSqlQueryResult
} from "./sql-inbox-v2-tenant-policy-authority-repository";

const tenantId = "tenant:tenant-1";
const otherTenantId = "tenant:tenant-2";
const family = "source_identity_claim" as const;
const policyId = "core:identity.claim.policy";
const employeeId = "employee:approver-1";
const approvedAt = "2026-07-14T09:00:00.000Z";
const activatedAt = "2026-07-14T09:01:00.000Z";
const revokedAt = "2026-07-14T09:02:00.000Z";
const digest = "a".repeat(64);

describe("SQL Inbox V2 tenant policy authority repository", () => {
  it("rejects strict invalid commands before opening a transaction", async () => {
    const executor = new ScriptedPolicyExecutor([]);
    const repository =
      createSqlInboxV2TenantPolicyAuthorityRepository(executor);
    const invalid = {
      ...approvalCommand(),
      untrustedGrant: true
    } as never;

    await expect(repository.approveVersion(invalid)).rejects.toBeDefined();
    expect(executor.transactionCount).toBe(0);
    expect(executor.queries).toEqual([]);
  });

  it("approves an immutable version tenant-first and distinguishes idempotency", async () => {
    const authority = versionAuthority();
    const executor = new ScriptedPolicyExecutor([
      [employeeRow()],
      [versionRow(authority)],
      [versionRow(authority)]
    ]);

    await expect(
      createSqlInboxV2TenantPolicyAuthorityRepository(executor).approveVersion(
        approvalCommand()
      )
    ).resolves.toEqual({ kind: "approved", authority });
    expect(executor.statementKinds()).toEqual([
      "lock_employee",
      "insert_version",
      "find_version"
    ]);
    expect(
      executor.renderedQueries().every(({ sql }) => sql.includes("tenant_id"))
    ).toBe(true);
    expect(executor.transactionIsolationLevels).toEqual(["read committed"]);

    const idempotent = new ScriptedPolicyExecutor([
      [employeeRow()],
      [],
      [versionRow(authority)]
    ]);
    await expect(
      createSqlInboxV2TenantPolicyAuthorityRepository(
        idempotent
      ).approveVersion(approvalCommand())
    ).resolves.toMatchObject({ kind: "already_approved", authority });
  });

  it("returns a deterministic immutable-version conflict", async () => {
    const winner = versionAuthority({
      definitionDigestSha256: "b".repeat(64) as never
    });
    const executor = new ScriptedPolicyExecutor([
      [employeeRow()],
      [],
      [versionRow(winner)]
    ]);

    await expect(
      createSqlInboxV2TenantPolicyAuthorityRepository(executor).approveVersion(
        approvalCommand()
      )
    ).resolves.toEqual({
      kind: "policy_version_conflict",
      currentAuthority: winner
    });
  });

  it("appends activation transition before bootstrapping the CAS head", async () => {
    const authority = versionAuthority();
    const activation = activeHead();
    const executor = new ScriptedPolicyExecutor([
      [],
      [versionRow(authority)],
      [employeeRow()],
      [{ revision: "1" }],
      [headRow(activation)]
    ]);

    const result =
      await createSqlInboxV2TenantPolicyAuthorityRepository(
        executor
      ).activateVersion(activationCommand());

    expect(result).toMatchObject({
      kind: "activated",
      activation: { state: "active", revision: "1" },
      transition: {
        operation: "activate",
        expectedHeadRevision: null,
        resultingHeadRevision: "1",
        previous: null
      }
    });
    expect(executor.statementKinds()).toEqual([
      "lock_head",
      "lock_version",
      "lock_employee",
      "insert_transition",
      "insert_head"
    ]);
  });

  it("appends exact revocation history before advancing the active head", async () => {
    const authority = versionAuthority();
    const active = activeHead();
    const revoked = revokedHead();
    const executor = new ScriptedPolicyExecutor([
      [headRow(active)],
      [versionRow(authority)],
      [employeeRow()],
      [{ revision: "2" }],
      [headRow(revoked)]
    ]);

    const result =
      await createSqlInboxV2TenantPolicyAuthorityRepository(
        executor
      ).revokeVersion(revocationCommand());

    expect(result).toMatchObject({
      kind: "revoked",
      activation: { state: "revoked", revision: "2" },
      transition: {
        operation: "revoke",
        expectedHeadRevision: "1",
        resultingHeadRevision: "2",
        previous: { state: "active" },
        resulting: { state: "revoked" }
      }
    });
    expect(executor.statementKinds()).toEqual([
      "lock_head",
      "lock_version",
      "lock_employee",
      "insert_transition",
      "revoke_head"
    ]);
  });

  it("returns stale revision, wrong version, state and actor conflicts before writes", async () => {
    const stale = new ScriptedPolicyExecutor([[headRow(activeHead())]]);
    await expect(
      createSqlInboxV2TenantPolicyAuthorityRepository(stale).revokeVersion({
        ...revocationCommand(),
        expectedHeadRevision: "2"
      } as never)
    ).resolves.toEqual({
      kind: "head_revision_conflict",
      currentHeadRevision: "1"
    });
    expect(stale.statementKinds()).toEqual(["lock_head"]);

    const wrongVersion = new ScriptedPolicyExecutor([[headRow(activeHead())]]);
    await expect(
      createSqlInboxV2TenantPolicyAuthorityRepository(
        wrongVersion
      ).revokeVersion({ ...revocationCommand(), policyVersion: "v2" } as never)
    ).resolves.toEqual({
      kind: "policy_version_conflict",
      currentPolicyVersion: "v1"
    });

    const inactive = new ScriptedPolicyExecutor([[headRow(revokedHead())]]);
    await expect(
      createSqlInboxV2TenantPolicyAuthorityRepository(inactive).revokeVersion({
        ...revocationCommand(),
        expectedHeadRevision: "2"
      } as never)
    ).resolves.toMatchObject({ kind: "head_state_conflict" });

    const missingEmployee = new ScriptedPolicyExecutor([
      [],
      [versionRow(versionAuthority())],
      []
    ]);
    await expect(
      createSqlInboxV2TenantPolicyAuthorityRepository(
        missingEmployee
      ).activateVersion(activationCommand())
    ).resolves.toEqual({ kind: "employee_not_found", employeeId });
    expect(missingEmployee.statementKinds()).not.toContain("insert_transition");
  });

  it("locks and validates the exact current policy proof for a caller transaction", async () => {
    const executor = new ScriptedPolicyExecutor([[exactAuthorityRow()]]);
    const result = await lockExactInScriptedTransaction(executor, exactInput());

    expect(result).toMatchObject({
      kind: "locked",
      headRevision: "1",
      authority: {
        headRevision: "1",
        approvedTrustedServiceId: "core:identity-resolver"
      }
    });
    const rendered = renderQuery(
      buildLockExactActiveInboxV2TenantPolicyAuthoritySql(exactInput())
    );
    expect(normalizeSql(rendered.sql)).toContain(
      "for share of head_row, version_row"
    );
    expect(rendered.params.slice(0, 3)).toEqual([tenantId, family, policyId]);
  });

  it.each([
    ["wrong version", { policyVersion: "v2" }, "policy_version_conflict"],
    [
      "wrong definition contract",
      { definitionContractVersion: "v2" },
      "definition_contract_version_conflict"
    ],
    [
      "wrong digest",
      { definitionDigestSha256: "b".repeat(64) },
      "definition_digest_conflict"
    ],
    [
      "wrong trusted service",
      { approvedTrustedServiceId: "core:other-resolver" },
      "trusted_service_conflict"
    ],
    [
      "wrong head revision",
      { expectedHeadRevision: "2" },
      "head_revision_conflict"
    ],
    [
      "backdated occurrence",
      { occurredAt: approvedAt },
      "occurred_before_activation"
    ]
  ] as const)("rejects an exact-lock %s", async (_label, overrides, kind) => {
    const executor = new ScriptedPolicyExecutor([[exactAuthorityRow()]]);
    await expect(
      lockExactInScriptedTransaction(executor, {
        ...exactInput(),
        ...overrides
      } as never)
    ).resolves.toMatchObject({ kind });
  });

  it("rejects a revoked head before considering a backdated occurrence", async () => {
    const executor = new ScriptedPolicyExecutor([
      [
        exactAuthorityRow({
          ...headRow(revokedHead()),
          activated_at: activatedAt,
          revoked_at: revokedAt
        })
      ]
    ]);

    await expect(
      lockExactInScriptedTransaction(executor, {
        ...exactInput(),
        occurredAt: approvedAt
      } as never)
    ).resolves.toEqual({ kind: "policy_inactive", currentHeadRevision: "2" });
  });

  it("rejects a corrupted approval-after-activation temporal chain", async () => {
    const invalidApprovalAt = "2026-07-14T09:01:30.000Z";
    const executor = new ScriptedPolicyExecutor([
      [
        exactAuthorityRow({
          version_approved_at: invalidApprovalAt,
          version_created_at: invalidApprovalAt,
          version_updated_at: invalidApprovalAt
        })
      ]
    ]);

    await expect(
      lockExactInScriptedTransaction(executor, exactInput())
    ).resolves.toEqual({
      kind: "authority_time_conflict",
      approvedAt: invalidApprovalAt,
      activatedAt
    });
  });

  it("returns not-found for another tenant or family without widening the lock", async () => {
    for (const input of [
      { ...exactInput(), tenantId: otherTenantId },
      {
        ...exactInput(),
        family: "conversation_client_link",
        policyId: "core:conversation.client-link.policy"
      }
    ] as const) {
      const executor = new ScriptedPolicyExecutor([[]]);
      await expect(
        lockExactInScriptedTransaction(executor, input as never)
      ).resolves.toEqual({ kind: "policy_not_found" });
    }
  });

  it("retries only nested retryable SQLSTATEs and bounds the transaction", async () => {
    const executor = new ScriptedPolicyExecutor([
      [],
      [versionRow(versionAuthority())],
      [employeeRow()],
      [{ revision: "1" }],
      [headRow(activeHead())]
    ]).failNextTransactions(
      { cause: Object.assign(new Error("deadlock"), { code: "40P01" }) },
      Object.assign(new Error("serialization"), { code: "40001" })
    );
    await expect(
      createSqlInboxV2TenantPolicyAuthorityRepository(executor).activateVersion(
        activationCommand()
      )
    ).resolves.toMatchObject({ kind: "activated" });
    expect(executor.transactionCount).toBe(3);
    expect(executor.transactionIsolationLevels).toEqual([
      "read committed",
      "read committed",
      "read committed"
    ]);

    const terminal = Object.assign(new Error("constraint"), { code: "23514" });
    const nonRetryable = new ScriptedPolicyExecutor([]).failNextTransactions(
      terminal
    );
    await expect(
      createSqlInboxV2TenantPolicyAuthorityRepository(
        nonRetryable
      ).approveVersion(approvalCommand())
    ).rejects.toBe(terminal);
    expect(nonRetryable.transactionCount).toBe(1);
  });
});

function lockExactInScriptedTransaction(
  executor: ScriptedPolicyExecutor,
  input: Parameters<
    typeof lockAndValidateExactActiveInboxV2TenantPolicyAuthority
  >[1]
) {
  return executor.transaction(
    (transaction) =>
      lockAndValidateExactActiveInboxV2TenantPolicyAuthority(
        transaction,
        input
      ),
    { isolationLevel: "read committed" }
  );
}

class ScriptedPolicyExecutor implements InboxV2TenantPolicyAuthorityTransactionExecutor {
  readonly queries: SQL[] = [];
  readonly transactionIsolationLevels: string[] = [];
  private readonly transactionFailures: unknown[] = [];
  transactionCount = 0;

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
    if (rows === undefined) {
      throw new Error(
        `Missing scripted response for ${renderQuery(query).sql}`
      );
    }
    return { rows: rows as readonly Row[] };
  }

  async transaction<TResult>(
    work: (
      transaction: InboxV2TenantPolicyAuthorityUseTransaction
    ) => Promise<TResult>,
    config: Readonly<{ isolationLevel: "read committed" }>
  ): Promise<TResult> {
    this.transactionCount += 1;
    this.transactionIsolationLevels.push(config.isolationLevel);
    if (this.transactionFailures.length > 0) {
      throw this.transactionFailures.shift();
    }
    return work(this as unknown as InboxV2TenantPolicyAuthorityUseTransaction);
  }

  renderedQueries() {
    return this.queries.map(renderQuery).map((query) => ({
      ...query,
      sql: normalizeSql(query.sql)
    }));
  }

  statementKinds(): string[] {
    return this.renderedQueries().map(({ sql }) => {
      if (sql.includes("from employees") && sql.includes("for share")) {
        return "lock_employee";
      }
      if (sql.startsWith("insert into inbox_v2_tenant_policy_versions")) {
        return "insert_version";
      }
      if (
        sql.includes("from inbox_v2_tenant_policy_versions") &&
        sql.includes("for share")
      ) {
        return "lock_version";
      }
      if (sql.includes("from inbox_v2_tenant_policy_versions")) {
        return "find_version";
      }
      if (
        sql.includes("from inbox_v2_tenant_policy_activation_heads") &&
        sql.includes("for update")
      ) {
        return "lock_head";
      }
      if (
        sql.startsWith(
          "insert into inbox_v2_tenant_policy_activation_transitions"
        )
      ) {
        return "insert_transition";
      }
      if (
        sql.startsWith("insert into inbox_v2_tenant_policy_activation_heads")
      ) {
        return "insert_head";
      }
      if (
        sql.startsWith("update inbox_v2_tenant_policy_activation_heads") &&
        sql.includes("set state = 'revoked'")
      ) {
        return "revoke_head";
      }
      if (sql.startsWith("update inbox_v2_tenant_policy_activation_heads")) {
        return "advance_head";
      }
      return "unknown";
    });
  }
}

function approvalCommand() {
  return inboxV2ApproveTenantPolicyVersionCommandSchema.parse({
    tenantId,
    family,
    policyId,
    policyVersion: "v1",
    definitionContractVersion: "v1",
    definitionDigestSha256: digest,
    approvedTrustedServiceId: "core:identity-resolver",
    approvedBy: { tenantId, kind: "employee", id: employeeId },
    approvedAt
  });
}

function activationCommand() {
  return inboxV2ActivateTenantPolicyVersionCommandSchema.parse({
    tenantId,
    family,
    policyId,
    policyVersion: "v1",
    expectedHeadRevision: null,
    activatedBy: { tenantId, kind: "employee", id: employeeId },
    activatedAt
  });
}

function revocationCommand() {
  return inboxV2RevokeTenantPolicyVersionCommandSchema.parse({
    tenantId,
    family,
    policyId,
    policyVersion: "v1",
    expectedHeadRevision: "1",
    revokedBy: { tenantId, kind: "employee", id: employeeId },
    revokedAt
  });
}

function exactInput() {
  return inboxV2ExactActiveTenantPolicyAuthorityInputSchema.parse({
    tenantId,
    family,
    policyId,
    policyVersion: "v1",
    definitionContractVersion: "v1",
    definitionDigestSha256: digest,
    approvedTrustedServiceId: "core:identity-resolver",
    expectedHeadRevision: "1",
    occurredAt: activatedAt
  });
}

function versionAuthority(
  overrides: Partial<InboxV2TenantPolicyVersionAuthority> = {}
): InboxV2TenantPolicyVersionAuthority {
  return inboxV2TenantPolicyVersionAuthoritySchema.parse({
    ...approvalCommand(),
    revision: "1",
    createdAt: approvedAt,
    updatedAt: approvedAt,
    ...overrides
  });
}

function activeHead(
  overrides: Partial<InboxV2TenantPolicyActivationHead> = {}
): InboxV2TenantPolicyActivationHead {
  const approval = approvalCommand();
  return inboxV2TenantPolicyActivationHeadSchema.parse({
    tenantId,
    family,
    policyId,
    policyVersion: approval.policyVersion,
    definitionContractVersion: approval.definitionContractVersion,
    definitionDigestSha256: approval.definitionDigestSha256,
    approvedTrustedServiceId: approval.approvedTrustedServiceId,
    state: "active",
    activatedBy: { tenantId, kind: "employee", id: employeeId },
    activatedAt,
    revokedBy: null,
    revokedAt: null,
    revision: "1",
    createdAt: activatedAt,
    updatedAt: activatedAt,
    ...overrides
  });
}

function revokedHead(): InboxV2TenantPolicyActivationHead {
  return inboxV2TenantPolicyActivationHeadSchema.parse({
    ...activeHead(),
    state: "revoked",
    revokedBy: { tenantId, kind: "employee", id: employeeId },
    revokedAt,
    revision: "2",
    updatedAt: revokedAt
  });
}

function employeeRow() {
  return { id: employeeId, created_at: approvedAt, deactivated_at: null };
}

function versionRow(authority: InboxV2TenantPolicyVersionAuthority) {
  return {
    tenant_id: authority.tenantId,
    family: authority.family,
    policy_id: authority.policyId,
    policy_version: authority.policyVersion,
    definition_contract_version: authority.definitionContractVersion,
    definition_digest_sha256: authority.definitionDigestSha256,
    approved_trusted_service_id: authority.approvedTrustedServiceId,
    approved_by_employee_id: authority.approvedBy.id,
    approved_at: authority.approvedAt,
    revision: authority.revision,
    created_at: authority.createdAt,
    updated_at: authority.updatedAt
  };
}

function headRow(head: InboxV2TenantPolicyActivationHead) {
  return {
    tenant_id: head.tenantId,
    family: head.family,
    policy_id: head.policyId,
    policy_version: head.policyVersion,
    definition_contract_version: head.definitionContractVersion,
    definition_digest_sha256: head.definitionDigestSha256,
    approved_trusted_service_id: head.approvedTrustedServiceId,
    state: head.state,
    activated_by_employee_id: head.activatedBy.id,
    activated_at: head.activatedAt,
    revoked_by_employee_id: head.revokedBy?.id ?? null,
    revoked_at: head.revokedAt,
    revision: head.revision,
    created_at: head.createdAt,
    updated_at: head.updatedAt
  };
}

function exactAuthorityRow(overrides: Record<string, unknown> = {}) {
  return {
    ...headRow(activeHead()),
    version_approved_by_employee_id: employeeId,
    version_approved_at: approvedAt,
    version_revision: "1",
    version_created_at: approvedAt,
    version_updated_at: approvedAt,
    ...overrides
  };
}

function renderQuery(query: SQL): { sql: string; params: unknown[] } {
  return new PgDialect().sqlToQuery(query);
}

function normalizeSql(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLowerCase();
}
