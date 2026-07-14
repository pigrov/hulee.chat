import type { EmployeeId, TenantId } from "@hulee/contracts";
import { CoreError } from "@hulee/core";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  buildListAccessAuditRecordsSql,
  buildListConversationRoutingAuditRecordsSql,
  createSqlSecurityAuditRepository
} from "./sql-security-audit-repository";
import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";

describe("SQL security audit repository", () => {
  it("writes tenant-scoped security audit records", async () => {
    const executor = new RecordingSqlExecutor([]);
    const repository = createSqlSecurityAuditRepository(executor);

    await repository.record({
      id: "audit:session-1:login",
      tenantId: "tenant-1" as TenantId,
      actorEmployeeId: "employee-1" as EmployeeId,
      action: "auth.login.succeeded",
      entityType: "session",
      entityId: "session-1",
      metadata: {
        accountId: "account-1",
        surface: "web"
      },
      occurredAt: new Date("2026-06-23T12:00:00.000Z")
    });

    expect(executor.queries).toHaveLength(1);
  });

  it("writes and lists access audit records", async () => {
    const tenantId = "tenant-1" as TenantId;
    const actorEmployeeId = "employee-admin" as EmployeeId;
    const targetEmployeeId = "employee-agent" as EmployeeId;
    const executor = new RecordingSqlExecutor([
      [],
      [
        {
          id: "audit:role-binding-1:created",
          tenant_id: tenantId,
          actor_employee_id: actorEmployeeId,
          action: "role_binding.created",
          entity_type: "role_binding",
          entity_id: "role-binding-1",
          metadata: {
            roleId: "role-sales",
            targetEmployeeId,
            permission: "client.view"
          },
          created_at: new Date("2026-06-23T12:00:00.000Z")
        }
      ]
    ]);
    const repository = createSqlSecurityAuditRepository(executor);

    await repository.record({
      id: "audit:role-binding-1:created",
      tenantId,
      actorEmployeeId,
      action: "role_binding.created",
      entityType: "role_binding",
      entityId: "role-binding-1",
      metadata: {
        roleId: "role-sales",
        targetEmployeeId
      },
      occurredAt: new Date("2026-06-23T12:00:00.000Z")
    });

    await expect(
      repository.listAccessRecords({
        tenantId,
        authorization: { kind: "tenant" },
        limit: 25,
        action: "role_binding.created",
        targetEmployeeId,
        roleId: "role-sales",
        permission: "client.view"
      })
    ).resolves.toEqual([
      {
        id: "audit:role-binding-1:created",
        tenantId,
        actorEmployeeId,
        action: "role_binding.created",
        entityType: "role_binding",
        entityId: "role-binding-1",
        metadata: {
          roleId: "role-sales",
          targetEmployeeId,
          permission: "client.view"
        },
        occurredAt: "2026-06-23T12:00:00.000Z"
      }
    ]);

    const writeQuery = renderQuery(executor.queries[0]);
    const listQuery = renderQuery(executor.queries[1]);

    expect(writeQuery.sql).toContain("insert into audit_log");
    expect(listQuery.sql).toContain("from audit_log");
    expect(listQuery.sql).toContain("metadata->>'targetEmployeeId'");
    expect(listQuery.sql).toContain("metadata->>'roleId'");
    expect(listQuery.sql).toContain("metadata->>'permission'");
    expect(listQuery.params).toEqual(
      expect.arrayContaining([
        tenantId,
        "role_binding.created",
        targetEmployeeId,
        "role-sales",
        "client.view"
      ])
    );
  });

  it("writes and lists conversation routing audit records", async () => {
    const tenantId = "tenant-1" as TenantId;
    const actorEmployeeId = "employee-admin" as EmployeeId;
    const executor = new RecordingSqlExecutor([
      [],
      [
        {
          id: "audit:conversation-1:routing",
          tenant_id: tenantId,
          actor_employee_id: actorEmployeeId,
          entity_id: "conversation-1",
          metadata: {
            previousCurrentQueueId: "queue-intake",
            currentQueueId: "queue-sales"
          },
          created_at: new Date("2026-06-23T12:00:00.000Z")
        }
      ]
    ]);
    const repository = createSqlSecurityAuditRepository(executor);

    await repository.record({
      id: "audit:conversation-1:routing",
      tenantId,
      actorEmployeeId,
      action: "conversation.routing.updated",
      entityType: "conversation",
      entityId: "conversation-1",
      metadata: {
        previousCurrentQueueId: "queue-intake",
        currentQueueId: "queue-sales"
      },
      occurredAt: new Date("2026-06-23T12:00:00.000Z")
    });

    await expect(
      repository.listConversationRoutingRecords({
        tenantId,
        authorization: {
          kind: "conversation",
          conversationId: "conversation-1"
        },
        conversationId: "conversation-1",
        limit: 5
      })
    ).resolves.toEqual([
      {
        id: "audit:conversation-1:routing",
        tenantId,
        actorEmployeeId,
        conversationId: "conversation-1",
        metadata: {
          previousCurrentQueueId: "queue-intake",
          currentQueueId: "queue-sales"
        },
        occurredAt: "2026-06-23T12:00:00.000Z"
      }
    ]);

    const listQuery = renderQuery(executor.queries[1]);

    expect(listQuery.sql).toContain("action = 'conversation.routing.updated'");
    expect(listQuery.sql).toContain("entity_type = 'conversation'");
    expect(listQuery.params).toEqual(
      expect.arrayContaining([tenantId, "conversation-1"])
    );
  });

  it("lists tenant conversation routing audit records with optional filters", async () => {
    const tenantId = "tenant-1" as TenantId;
    const actorEmployeeId = "employee-admin" as EmployeeId;
    const from = new Date("2026-06-23T00:00:00.000Z");
    const to = new Date("2026-06-23T23:59:59.999Z");
    const executor = new RecordingSqlExecutor([
      [
        {
          id: "audit:conversation-1:routing",
          tenant_id: tenantId,
          actor_employee_id: actorEmployeeId,
          entity_id: "conversation-1",
          metadata: {
            currentQueueId: "queue-sales"
          },
          created_at: new Date("2026-06-23T12:00:00.000Z")
        },
        {
          id: "audit:conversation-2:routing",
          tenant_id: tenantId,
          actor_employee_id: actorEmployeeId,
          entity_id: "conversation-2",
          metadata: {
            currentQueueId: "queue-claims"
          },
          created_at: new Date("2026-06-23T13:00:00.000Z")
        }
      ]
    ]);
    const repository = createSqlSecurityAuditRepository(executor);

    await expect(
      repository.listConversationRoutingRecords({
        tenantId,
        authorization: { kind: "tenant" },
        actorEmployeeId,
        from,
        to,
        limit: 25
      })
    ).resolves.toMatchObject([
      {
        id: "audit:conversation-1:routing",
        tenantId,
        actorEmployeeId,
        conversationId: "conversation-1"
      },
      {
        id: "audit:conversation-2:routing",
        tenantId,
        actorEmployeeId,
        conversationId: "conversation-2"
      }
    ]);

    const listQuery = renderQuery(executor.queries[0]);

    expect(listQuery.sql).toContain("actor_employee_id");
    expect(listQuery.sql).toContain("created_at >=");
    expect(listQuery.sql).toContain("created_at <=");
    expect(listQuery.params).toEqual(
      expect.arrayContaining([tenantId, actorEmployeeId, from, to, 25])
    );
  });

  it("rejects cross-tenant conversation routing audit rows", async () => {
    const repository = createSqlSecurityAuditRepository(
      new RecordingSqlExecutor([
        [
          {
            id: "audit:conversation-cross-tenant:routing",
            tenant_id: "tenant-2",
            actor_employee_id: "employee-admin",
            entity_id: "conversation-1",
            metadata: {
              currentQueueId: "queue-sales"
            },
            created_at: new Date("2026-06-23T12:00:00.000Z")
          }
        ]
      ])
    );

    await expect(
      repository.listConversationRoutingRecords({
        tenantId: "tenant-1" as TenantId,
        authorization: {
          kind: "conversation",
          conversationId: "conversation-1"
        },
        conversationId: "conversation-1",
        limit: 10
      })
    ).rejects.toEqual(new CoreError("tenant.boundary_violation"));
  });

  it("rejects cross-tenant access audit rows", async () => {
    const repository = createSqlSecurityAuditRepository(
      new RecordingSqlExecutor([
        [
          {
            id: "audit:cross-tenant",
            tenant_id: "tenant-2",
            actor_employee_id: "employee-admin",
            action: "role.created",
            entity_type: "role",
            entity_id: "role-sales",
            metadata: {
              roleId: "role-sales"
            },
            created_at: new Date("2026-06-23T12:00:00.000Z")
          }
        ]
      ])
    );

    await expect(
      repository.listAccessRecords({
        tenantId: "tenant-1" as TenantId,
        authorization: { kind: "tenant" },
        limit: 50
      })
    ).rejects.toThrow(new CoreError("tenant.boundary_violation"));
  });

  it("keeps only records with an exact authorized scope facet", async () => {
    const tenantId = "tenant-1" as TenantId;
    const row = (input: {
      readonly id: string;
      readonly authorizationScopes?: readonly Record<string, string>[];
    }) => ({
      id: input.id,
      tenant_id: tenantId,
      actor_employee_id: "employee-admin",
      action: "direct_grant.created",
      entity_type: "direct_grant",
      entity_id: input.id,
      metadata:
        input.authorizationScopes === undefined
          ? {}
          : { authorizationScopes: input.authorizationScopes },
      created_at: new Date("2026-06-23T12:00:00.000Z")
    });
    const repository = createSqlSecurityAuditRepository(
      new RecordingSqlExecutor([
        [
          row({
            id: "audit:allowed",
            authorizationScopes: [{ type: "queue", id: "queue-sales" }]
          }),
          row({
            id: "audit:other-scope",
            authorizationScopes: [{ type: "queue", id: "queue-claims" }]
          }),
          row({ id: "audit:missing-facets" })
        ]
      ])
    );

    await expect(
      repository.listAccessRecords({
        tenantId,
        authorization: {
          kind: "scoped",
          orgUnitIds: [],
          teamIds: [],
          queueIds: ["queue-sales"]
        },
        limit: 50
      })
    ).resolves.toMatchObject([{ id: "audit:allowed" }]);
  });

  it("shows a cross-scope event to the source viewer with foreign facets redacted", async () => {
    const tenantId = "tenant-1" as TenantId;
    const repository = createSqlSecurityAuditRepository(
      new RecordingSqlExecutor([[crossScopeRoutingAuditRow(tenantId)]])
    );

    const records = await repository.listConversationRoutingRecords({
      tenantId,
      authorization: {
        kind: "scoped",
        orgUnitIds: [],
        teamIds: [],
        queueIds: ["queue-sales"]
      },
      limit: 50
    });

    expect(records).toHaveLength(1);
    expect(records[0]?.metadata).toEqual({
      conversationId: "conversation-1",
      previousCurrentQueueId: "queue-sales",
      queueIds: ["queue-sales"],
      teamIds: [],
      scopeType: "queue",
      nestedScope: { type: "team" },
      authorizationScopes: [{ type: "queue", id: "queue-sales" }]
    });
  });

  it("shows a cross-scope event to the destination viewer with source facets redacted", async () => {
    const tenantId = "tenant-1" as TenantId;
    const repository = createSqlSecurityAuditRepository(
      new RecordingSqlExecutor([[crossScopeRoutingAuditRow(tenantId)]])
    );

    const records = await repository.listConversationRoutingRecords({
      tenantId,
      authorization: {
        kind: "scoped",
        orgUnitIds: [],
        teamIds: [],
        queueIds: ["queue-claims"]
      },
      limit: 50
    });

    expect(records).toHaveLength(1);
    expect(records[0]?.metadata).toEqual({
      conversationId: "conversation-1",
      currentQueueId: "queue-claims",
      queueIds: ["queue-claims"],
      teamIds: [],
      scopeType: "queue",
      scopeId: "queue-claims",
      nestedScope: { type: "team" },
      authorizationScopes: [{ type: "queue", id: "queue-claims" }]
    });
  });

  it("redacts the opposite RBAC facet for source and destination scoped viewers", async () => {
    const tenantId = "tenant-1" as TenantId;
    const row = {
      id: "audit:binding-cross-scope",
      tenant_id: tenantId,
      actor_employee_id: "employee-admin",
      action: "role_binding.created",
      entity_type: "role_binding",
      entity_id: "binding-cross-scope",
      metadata: {
        roleId: "role-agent",
        subjectType: "team",
        subjectId: "team-claims",
        scopeType: "queue",
        scopeId: "queue-sales",
        authorizationScopes: [
          { type: "team", id: "team-claims" },
          { type: "queue", id: "queue-sales" }
        ]
      },
      created_at: new Date("2026-06-23T12:00:00.000Z")
    };
    const sourceRepository = createSqlSecurityAuditRepository(
      new RecordingSqlExecutor([[row]])
    );
    const destinationRepository = createSqlSecurityAuditRepository(
      new RecordingSqlExecutor([[row]])
    );

    const sourceRecords = await sourceRepository.listAccessRecords({
      tenantId,
      authorization: {
        kind: "scoped",
        orgUnitIds: [],
        teamIds: ["team-claims"],
        queueIds: []
      },
      limit: 50
    });
    const destinationRecords = await destinationRepository.listAccessRecords({
      tenantId,
      authorization: {
        kind: "scoped",
        orgUnitIds: [],
        teamIds: [],
        queueIds: ["queue-sales"]
      },
      limit: 50
    });

    expect(sourceRecords[0]?.metadata).toEqual({
      roleId: "role-agent",
      subjectType: "team",
      subjectId: "team-claims",
      scopeType: "queue",
      authorizationScopes: [{ type: "team", id: "team-claims" }]
    });
    expect(destinationRecords[0]?.metadata).toEqual({
      roleId: "role-agent",
      subjectType: "team",
      scopeType: "queue",
      scopeId: "queue-sales",
      authorizationScopes: [{ type: "queue", id: "queue-sales" }]
    });
  });

  it("hides non-structural exact scope IDs from a scoped target viewer", async () => {
    const tenantId = "tenant-1" as TenantId;
    const repository = createSqlSecurityAuditRepository(
      new RecordingSqlExecutor([
        [
          {
            id: "audit:legacy-client-cleanup",
            tenant_id: tenantId,
            actor_employee_id: "employee-admin",
            action: "direct_grant.revoked",
            entity_type: "direct_grant",
            entity_id: "grant-client",
            metadata: {
              targetEmployeeId: "employee-agent",
              scopeType: "client",
              scopeId: "client-secret",
              reason: "legacy cleanup",
              authorizationScopes: [
                { type: "queue", id: "queue-sales" },
                { type: "client", id: "client-secret" }
              ]
            },
            created_at: new Date("2026-06-23T12:00:00.000Z")
          }
        ]
      ])
    );

    const records = await repository.listAccessRecords({
      tenantId,
      authorization: {
        kind: "scoped",
        orgUnitIds: [],
        teamIds: [],
        queueIds: ["queue-sales"]
      },
      limit: 50
    });

    expect(records[0]?.metadata).toEqual({
      targetEmployeeId: "employee-agent",
      scopeType: "client",
      reason: "legacy cleanup",
      authorizationScopes: [{ type: "queue", id: "queue-sales" }]
    });
  });

  it("returns complete cross-scope metadata to tenant audit", async () => {
    const tenantId = "tenant-1" as TenantId;
    const row = crossScopeRoutingAuditRow(tenantId);
    const repository = createSqlSecurityAuditRepository(
      new RecordingSqlExecutor([[row]])
    );

    const records = await repository.listConversationRoutingRecords({
      tenantId,
      authorization: { kind: "tenant" },
      limit: 50
    });

    expect(records[0]?.metadata).toEqual(row.metadata);
  });

  it("applies scoped authorization before ordering and limiting", () => {
    const query = renderQuery(
      buildListAccessAuditRecordsSql({
        tenantId: "tenant-1" as TenantId,
        authorization: {
          kind: "scoped",
          orgUnitIds: ["org-sales"],
          teamIds: ["team-sales"],
          queueIds: ["queue-sales"]
        },
        limit: 25
      })
    );

    const authorizationIndex = query.sql.indexOf("authorizationScopes");
    const orderIndex = query.sql.indexOf("order by created_at desc");
    const limitIndex = query.sql.indexOf("limit");

    expect(query.sql).toContain("jsonb_array_elements");
    expect(query.sql).toContain("jsonb_typeof");
    expect(query.sql).toContain("else '[]'::jsonb");
    expect(authorizationIndex).toBeGreaterThan(-1);
    expect(orderIndex).toBeGreaterThan(authorizationIndex);
    expect(limitIndex).toBeGreaterThan(orderIndex);
    expect(query.params).toEqual(
      expect.arrayContaining([
        "org_unit",
        "org-sales",
        "team",
        "team-sales",
        "queue",
        "queue-sales"
      ])
    );
  });

  it("fails closed for scoped authorization without usable facets", () => {
    const query = renderQuery(
      buildListConversationRoutingAuditRecordsSql({
        tenantId: "tenant-1" as TenantId,
        authorization: {
          kind: "scoped",
          orgUnitIds: [],
          teamIds: ["   "],
          queueIds: []
        },
        limit: 50
      })
    );

    expect(query.sql).toContain("and false");
    expect(query.sql).not.toContain("authorizationScopes");
  });

  it("lets tenant authorization read legacy records without scope facets", () => {
    const query = renderQuery(
      buildListAccessAuditRecordsSql({
        tenantId: "tenant-1" as TenantId,
        authorization: { kind: "tenant" },
        limit: 50
      })
    );

    expect(query.sql).toContain("and true");
    expect(query.sql).not.toContain("authorizationScopes");
  });

  it("restricts conversation authorization to the exact routing entity", () => {
    const query = renderQuery(
      buildListConversationRoutingAuditRecordsSql({
        tenantId: "tenant-1" as TenantId,
        authorization: {
          kind: "conversation",
          conversationId: "conversation-1"
        },
        conversationId: "conversation-1",
        limit: 5
      })
    );

    expect(query.sql).toContain("and entity_id =");
    expect(
      query.params.filter((parameter) => parameter === "conversation-1")
    ).toHaveLength(3);
    expect(query.sql.indexOf("entity_id =")).toBeLessThan(
      query.sql.indexOf("order by created_at desc")
    );
  });

  it("fails closed when conversation authorization and filter differ", () => {
    const query = renderQuery(
      buildListConversationRoutingAuditRecordsSql({
        tenantId: "tenant-1" as TenantId,
        authorization: {
          kind: "conversation",
          conversationId: "conversation-1"
        },
        conversationId: "conversation-2",
        limit: 5
      })
    );

    expect(query.sql).toContain("and false");
  });
});

class RecordingSqlExecutor implements RawSqlExecutor {
  readonly queries: SQL[] = [];
  private nextResultIndex = 0;

  constructor(
    private readonly resultSets: readonly (readonly Record<string, unknown>[])[]
  ) {}

  async execute<Row extends Record<string, unknown>>(
    query: SQL
  ): Promise<RawSqlQueryResult<Row>> {
    this.queries.push(query);
    const rows = this.resultSets[this.nextResultIndex] ?? [];
    this.nextResultIndex += 1;

    return {
      rows: rows as readonly Row[]
    };
  }
}

function renderQuery(query: SQL | undefined): {
  sql: string;
  params: unknown[];
} {
  if (query === undefined) {
    throw new Error("Expected a recorded SQL query.");
  }

  return new PgDialect().sqlToQuery(query);
}

function crossScopeRoutingAuditRow(tenantId: TenantId) {
  return {
    id: "audit:conversation-1:routing",
    tenant_id: tenantId,
    actor_employee_id: "employee-admin",
    entity_id: "conversation-1",
    metadata: {
      conversationId: "conversation-1",
      previousCurrentQueueId: "queue-sales",
      currentQueueId: "queue-claims",
      previousAssignedTeamId: "team-sales",
      assignedTeamId: "team-claims",
      queueIds: ["queue-sales", "queue-claims"],
      teamIds: ["team-sales", "team-claims"],
      scopeType: "queue",
      scopeId: "queue-claims",
      nestedScope: { type: "team", id: "team-claims" },
      authorizationScopes: [
        { type: "queue", id: "queue-sales" },
        { type: "queue", id: "queue-claims" },
        { type: "team", id: "team-sales" },
        { type: "team", id: "team-claims" }
      ]
    },
    created_at: new Date("2026-06-23T12:00:00.000Z")
  };
}
