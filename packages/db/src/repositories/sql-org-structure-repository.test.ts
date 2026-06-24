import type { TenantId } from "@hulee/contracts";
import { CoreError } from "@hulee/core";
import type { EmployeeId } from "@hulee/contracts";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";
import { createSqlOrgStructureRepository } from "./sql-org-structure-repository";

const tenantId = "tenant_org_1" as TenantId;
const otherTenantId = "tenant_org_2" as TenantId;
const now = new Date("2026-06-23T10:00:00.000Z");

describe("SQL org structure repository", () => {
  it("writes tenant-scoped org units and work queues", async () => {
    const executor = new RecordingSqlExecutor([
      [
        {
          id: "org-sales",
          tenant_id: tenantId,
          parent_org_unit_id: null,
          name: "Sales",
          kind: "department",
          status: "active"
        }
      ],
      [
        {
          id: "team-sales",
          tenant_id: tenantId,
          name: "Sales team"
        }
      ],
      [
        {
          id: "queue-sales",
          tenant_id: tenantId,
          name: "Sales queue",
          kind: "sales",
          owning_org_unit_id: "org-sales",
          status: "active",
          routing_config: {
            priority: "normal"
          }
        }
      ]
    ]);
    const repository = createSqlOrgStructureRepository(executor);

    await repository.upsertOrgUnit({
      id: "org-sales",
      tenantId,
      name: "Sales",
      kind: "department",
      updatedAt: now
    });
    await repository.upsertTeam({
      id: "team-sales",
      tenantId,
      name: "Sales team",
      updatedAt: now
    });
    await repository.upsertWorkQueue({
      id: "queue-sales",
      tenantId,
      name: "Sales queue",
      kind: "sales",
      owningOrgUnitId: "org-sales",
      routingConfig: {
        priority: "normal"
      },
      updatedAt: now
    });

    expect(executor.queries).toHaveLength(3);
    const orgUnitQuery = renderQuery(executor.queries[0]);
    const teamQuery = renderQuery(executor.queries[1]);
    const queueQuery = renderQuery(executor.queries[2]);

    expect(orgUnitQuery.sql).toContain("insert into org_units");
    expect(orgUnitQuery.sql).toContain("where org_units.tenant_id");
    expect(orgUnitQuery.params).toContain(tenantId);
    expect(teamQuery.sql).toContain("insert into teams");
    expect(teamQuery.sql).toContain("where teams.tenant_id");
    expect(teamQuery.params).toEqual(
      expect.arrayContaining([tenantId, "team-sales", "Sales team"])
    );
    expect(queueQuery.sql).toContain("insert into work_queues");
    expect(queueQuery.sql).toContain("owning_org_unit");
    expect(queueQuery.sql).toContain("where work_queues.tenant_id");
    expect(queueQuery.params).toEqual(
      expect.arrayContaining([tenantId, "queue-sales", "org-sales"])
    );
  });

  it("lists only tenant-scoped rows and rejects cross-tenant results", async () => {
    const executor = new RecordingSqlExecutor([
      [
        {
          id: "org-sales",
          tenant_id: tenantId,
          parent_org_unit_id: null,
          name: "Sales",
          kind: "department",
          status: "active"
        }
      ],
      [
        {
          id: "queue-other",
          tenant_id: otherTenantId,
          name: "Other queue",
          kind: "support",
          owning_org_unit_id: null,
          status: "active",
          routing_config: {}
        }
      ],
      [
        {
          id: "team-other",
          tenant_id: otherTenantId,
          name: "Other team"
        }
      ]
    ]);
    const repository = createSqlOrgStructureRepository(executor);

    await expect(
      repository.listOrgUnits({ tenantId, activeOnly: true })
    ).resolves.toEqual([
      {
        id: "org-sales",
        tenantId,
        parentOrgUnitId: null,
        name: "Sales",
        kind: "department",
        status: "active"
      }
    ]);
    await expect(repository.listWorkQueues({ tenantId })).rejects.toThrow(
      new CoreError("tenant.boundary_violation")
    );
    await expect(repository.listTeams({ tenantId })).rejects.toThrow(
      new CoreError("tenant.boundary_violation")
    );

    const orgUnitQuery = renderQuery(executor.queries[0]);

    expect(orgUnitQuery.sql).toContain("from org_units");
    expect(orgUnitQuery.sql).toContain("and status = 'active'");
  });

  it("replaces employee org unit and work queue memberships with active tenant references", async () => {
    const executor = new RecordingSqlExecutor([
      [
        {
          employee_exists: true,
          references_valid: true
        }
      ],
      [
        {
          employee_exists: true,
          references_valid: true
        }
      ],
      [
        {
          employee_exists: true,
          references_valid: true
        }
      ]
    ]);
    const repository = createSqlOrgStructureRepository(executor);

    await repository.setEmployeeOrgUnitMemberships({
      tenantId,
      employeeId: "employee-sales" as EmployeeId,
      orgUnitIds: ["org-sales"],
      updatedAt: now
    });
    await repository.setEmployeeTeamMemberships({
      tenantId,
      employeeId: "employee-sales" as EmployeeId,
      teamIds: ["team-sales"],
      updatedAt: now
    });
    await repository.setEmployeeWorkQueueMemberships({
      tenantId,
      employeeId: "employee-sales" as EmployeeId,
      workQueueIds: ["queue-sales"],
      updatedAt: now
    });

    expect(executor.queries).toHaveLength(3);
    const orgUnitQuery = renderQuery(executor.queries[0]);
    const teamQuery = renderQuery(executor.queries[1]);
    const workQueueQuery = renderQuery(executor.queries[2]);

    expect(orgUnitQuery.sql).toContain("employee_org_unit_memberships");
    expect(orgUnitQuery.sql).toContain("org_units.status = 'active'");
    expect(orgUnitQuery.params).toEqual(
      expect.arrayContaining([tenantId, "employee-sales", '["org-sales"]'])
    );
    expect(teamQuery.sql).toContain("employee_team_memberships");
    expect(teamQuery.sql).toContain("teams");
    expect(teamQuery.params).toEqual(
      expect.arrayContaining([tenantId, "employee-sales", '["team-sales"]'])
    );
    expect(workQueueQuery.sql).toContain("employee_work_queue_memberships");
    expect(workQueueQuery.sql).toContain("work_queues.status = 'active'");
    expect(workQueueQuery.params).toEqual(
      expect.arrayContaining([tenantId, "employee-sales", '["queue-sales"]'])
    );
  });

  it("rejects employee membership updates when employee or references are invalid", async () => {
    const repository = createSqlOrgStructureRepository(
      new RecordingSqlExecutor([
        [
          {
            employee_exists: false,
            references_valid: true
          }
        ],
        [
          {
            employee_exists: true,
            references_valid: false
          }
        ],
        [
          {
            employee_exists: true,
            references_valid: false
          }
        ]
      ])
    );

    await expect(
      repository.setEmployeeOrgUnitMemberships({
        tenantId,
        employeeId: "employee-missing" as EmployeeId,
        orgUnitIds: [],
        updatedAt: now
      })
    ).rejects.toThrow(new CoreError("tenant.boundary_violation"));
    await expect(
      repository.setEmployeeTeamMemberships({
        tenantId,
        employeeId: "employee-sales" as EmployeeId,
        teamIds: ["team-missing"],
        updatedAt: now
      })
    ).rejects.toThrow(new CoreError("validation.failed"));
    await expect(
      repository.setEmployeeWorkQueueMemberships({
        tenantId,
        employeeId: "employee-sales" as EmployeeId,
        workQueueIds: ["queue-missing"],
        updatedAt: now
      })
    ).rejects.toThrow(new CoreError("validation.failed"));
  });

  it("rejects invalid kinds, statuses and self-parenting before SQL", async () => {
    const executor = new RecordingSqlExecutor([]);
    const repository = createSqlOrgStructureRepository(executor);

    await expect(
      repository.upsertOrgUnit({
        id: "org-sales",
        tenantId,
        name: "Sales",
        kind: "invalid" as never,
        updatedAt: now
      })
    ).rejects.toThrow(new CoreError("validation.failed"));
    await expect(
      repository.upsertOrgUnit({
        id: "org-sales",
        tenantId,
        parentOrgUnitId: "org-sales",
        name: "Sales",
        kind: "department",
        updatedAt: now
      })
    ).rejects.toThrow(new CoreError("validation.failed"));
    await expect(
      repository.upsertWorkQueue({
        id: "queue-sales",
        tenantId,
        name: "Sales",
        kind: "sales",
        status: "deleted" as never,
        updatedAt: now
      })
    ).rejects.toThrow(new CoreError("validation.failed"));

    expect(executor.queries).toHaveLength(0);
  });

  it("throws tenant boundary violation when parent references are not tenant-local", async () => {
    const executor = new RecordingSqlExecutor([[], []]);
    const repository = createSqlOrgStructureRepository(executor);

    await expect(
      repository.upsertOrgUnit({
        id: "org-child",
        tenantId,
        parentOrgUnitId: "org-missing",
        name: "Child",
        kind: "department",
        updatedAt: now
      })
    ).rejects.toThrow(new CoreError("tenant.boundary_violation"));
    await expect(
      repository.upsertWorkQueue({
        id: "queue-sales",
        tenantId,
        name: "Sales",
        kind: "sales",
        owningOrgUnitId: "org-missing",
        updatedAt: now
      })
    ).rejects.toThrow(new CoreError("tenant.boundary_violation"));
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
