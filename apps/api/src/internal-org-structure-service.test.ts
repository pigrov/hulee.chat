import type { EmployeeId, TenantId } from "@hulee/contracts";
import type { OrgStructureRepository } from "@hulee/db";
import { describe, expect, it, vi } from "vitest";

import { createInternalOrgStructureService } from "./internal-org-structure-service";

const tenantId = "tenant-1" as TenantId;
const employeeId = "employee-1" as EmployeeId;
const context = {
  requestId: "request-1",
  tenantId,
  employeeId
};
const now = new Date("2026-06-23T10:00:00.000Z");

describe("internal org structure service", () => {
  it("loads org units and work queues through tenant context", async () => {
    const repository = repositoryStub({
      orgUnits: [
        {
          id: "org-sales",
          tenantId,
          parentOrgUnitId: null,
          name: "Sales",
          kind: "department",
          status: "active"
        }
      ],
      workQueues: [
        {
          id: "queue-sales",
          tenantId,
          name: "Sales queue",
          kind: "sales",
          owningOrgUnitId: "org-sales",
          status: "active",
          routingConfig: {}
        }
      ]
    });
    const service = createInternalOrgStructureService({ repository });

    await expect(service.loadOrgStructure(context)).resolves.toEqual({
      orgUnits: [
        {
          id: "org-sales",
          parentOrgUnitId: null,
          name: "Sales",
          kind: "department",
          status: "active"
        }
      ],
      workQueues: [
        {
          id: "queue-sales",
          name: "Sales queue",
          kind: "sales",
          owningOrgUnitId: "org-sales",
          status: "active",
          routingConfig: {}
        }
      ]
    });
    expect(repository.listOrgUnits).toHaveBeenCalledWith({ tenantId });
    expect(repository.listWorkQueues).toHaveBeenCalledWith({ tenantId });
  });

  it("upserts org units and queues with generated tenant-scoped ids", async () => {
    const repository = repositoryStub();
    const service = createInternalOrgStructureService({
      repository,
      now: () => now,
      idFactory: () => "id-1"
    });

    await service.upsertOrgUnit(context, {
      name: "Sales",
      kind: "department",
      status: "active"
    });
    await service.upsertWorkQueue(context, {
      name: "Sales queue",
      kind: "sales",
      owningOrgUnitId: "org-sales",
      status: "active",
      routingConfig: {
        priority: "normal"
      }
    });

    expect(repository.upsertOrgUnit).toHaveBeenCalledWith({
      id: "org_unit:tenant-1:id-1",
      tenantId,
      parentOrgUnitId: undefined,
      name: "Sales",
      kind: "department",
      status: "active",
      updatedAt: now
    });
    expect(repository.upsertWorkQueue).toHaveBeenCalledWith({
      id: "queue:tenant-1:id-1",
      tenantId,
      name: "Sales queue",
      kind: "sales",
      owningOrgUnitId: "org-sales",
      status: "active",
      routingConfig: {
        priority: "normal"
      },
      updatedAt: now
    });
  });
});

function repositoryStub(input?: {
  orgUnits?: Awaited<ReturnType<OrgStructureRepository["listOrgUnits"]>>;
  workQueues?: Awaited<ReturnType<OrgStructureRepository["listWorkQueues"]>>;
}): OrgStructureRepository {
  const orgUnits = input?.orgUnits ?? [];
  const workQueues = input?.workQueues ?? [];

  return {
    upsertOrgUnit: vi.fn(async (request) => ({
      id: request.id,
      tenantId: request.tenantId,
      parentOrgUnitId: request.parentOrgUnitId ?? null,
      name: request.name,
      kind: request.kind,
      status: request.status ?? "active"
    })),
    upsertWorkQueue: vi.fn(async (request) => ({
      id: request.id,
      tenantId: request.tenantId,
      name: request.name,
      kind: request.kind,
      owningOrgUnitId: request.owningOrgUnitId ?? null,
      status: request.status ?? "active",
      routingConfig: request.routingConfig ?? {}
    })),
    listOrgUnits: vi.fn(async () => orgUnits),
    listWorkQueues: vi.fn(async () => workQueues),
    setEmployeeOrgUnitMemberships: vi.fn(async () => undefined),
    setEmployeeWorkQueueMemberships: vi.fn(async () => undefined)
  };
}
