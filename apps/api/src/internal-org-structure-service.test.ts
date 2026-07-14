import type { EmployeeId, TenantId } from "@hulee/contracts";
import {
  CoreError,
  type PermissionRoleBinding,
  type PermissionScope
} from "@hulee/core";
import type {
  OrgStructureRepository,
  OrgUnitRecord,
  TenantEmployeeRecord,
  WorkQueueRecord
} from "@hulee/db";
import { describe, expect, it, vi } from "vitest";

import {
  createInternalOrgStructureService,
  type InternalOrgStructureServiceOptions
} from "./internal-org-structure-service";

const tenantId = "tenant-1" as TenantId;
const employeeId = "employee-1" as EmployeeId;
const context = {
  requestId: "request-1",
  tenantId,
  employeeId
};
const now = new Date("2026-06-23T10:00:00.000Z");

const rootOrgUnit = orgUnit({
  id: "org-root",
  parentOrgUnitId: null,
  name: "Root"
});
const salesOrgUnit = orgUnit({
  id: "org-sales",
  parentOrgUnitId: "org-root",
  name: "Sales"
});
const claimsOrgUnit = orgUnit({
  id: "org-claims",
  parentOrgUnitId: "org-root",
  name: "Claims"
});
const salesChildOrgUnit = orgUnit({
  id: "org-sales-child",
  parentOrgUnitId: "org-sales",
  name: "Sales child"
});
const salesQueue = workQueue({
  id: "queue-sales",
  owningOrgUnitId: "org-sales",
  name: "Sales queue"
});
const claimsQueue = workQueue({
  id: "queue-claims",
  owningOrgUnitId: "org-claims",
  name: "Claims queue"
});
const unownedQueue = workQueue({
  id: "queue-unowned",
  owningOrgUnitId: null,
  name: "Unowned queue"
});

describe("internal org structure service", () => {
  it("lets a tenant-scoped manager list every org unit and work queue", async () => {
    const repository = repositoryStub({
      orgUnits: [rootOrgUnit, salesOrgUnit, claimsOrgUnit],
      workQueues: [salesQueue, claimsQueue, unownedQueue]
    });
    const service = createInternalOrgStructureService(
      serviceOptions({ repository, scopes: [{ type: "tenant" }] })
    );

    await expect(service.loadOrgStructure(context)).resolves.toEqual({
      orgUnits: [
        {
          id: "org-root",
          parentOrgUnitId: null,
          name: "Root",
          kind: "department",
          status: "active"
        },
        {
          id: "org-sales",
          parentOrgUnitId: "org-root",
          name: "Sales",
          kind: "department",
          status: "active"
        },
        {
          id: "org-claims",
          parentOrgUnitId: "org-root",
          name: "Claims",
          kind: "department",
          status: "active"
        }
      ],
      workQueues: [
        {
          id: "queue-sales",
          name: "Sales queue",
          kind: "custom",
          owningOrgUnitId: "org-sales",
          status: "active",
          routingConfig: {}
        },
        {
          id: "queue-claims",
          name: "Claims queue",
          kind: "custom",
          owningOrgUnitId: "org-claims",
          status: "active",
          routingConfig: {}
        },
        {
          id: "queue-unowned",
          name: "Unowned queue",
          kind: "custom",
          owningOrgUnitId: null,
          status: "active",
          routingConfig: {}
        }
      ]
    });
    expect(repository.listOrgUnits).toHaveBeenCalledWith({ tenantId });
    expect(repository.listWorkQueues).toHaveBeenCalledWith({ tenantId });
  });

  it("filters an org-scoped list and redacts hidden parent and owner ids", async () => {
    const repository = repositoryStub({
      orgUnits: [rootOrgUnit, salesOrgUnit, claimsOrgUnit],
      workQueues: [salesQueue, claimsQueue, unownedQueue]
    });
    const service = createInternalOrgStructureService(
      serviceOptions({ repository, scopes: [orgScope("org-sales")] })
    );

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
          kind: "custom",
          owningOrgUnitId: "org-sales",
          status: "active",
          routingConfig: {}
        }
      ]
    });
  });

  it("requires the destination scope for creates and tenant scope for root or unowned creates", async () => {
    const scopedRepository = repositoryStub({ orgUnits: [salesOrgUnit] });
    const scopedService = createInternalOrgStructureService(
      serviceOptions({
        repository: scopedRepository,
        scopes: [orgScope("org-sales")]
      })
    );

    await expect(
      scopedService.upsertOrgUnit(context, {
        parentOrgUnitId: "org-sales",
        name: "Sales child",
        kind: "department",
        status: "active"
      })
    ).resolves.toMatchObject({
      parentOrgUnitId: "org-sales",
      name: "Sales child"
    });
    await expect(
      scopedService.upsertWorkQueue(context, {
        name: "Sales queue",
        kind: "sales",
        owningOrgUnitId: "org-sales",
        status: "active",
        routingConfig: {}
      })
    ).resolves.toMatchObject({
      owningOrgUnitId: "org-sales",
      name: "Sales queue"
    });
    await expect(
      scopedService.upsertOrgUnit(context, {
        name: "Root org",
        kind: "department",
        status: "active"
      })
    ).rejects.toEqual(new CoreError("permission.denied"));
    await expect(
      scopedService.upsertWorkQueue(context, {
        name: "Unowned queue",
        kind: "custom",
        status: "active",
        routingConfig: {}
      })
    ).rejects.toEqual(new CoreError("permission.denied"));
    expect(scopedRepository.upsertOrgUnit).toHaveBeenCalledTimes(1);
    expect(scopedRepository.upsertWorkQueue).toHaveBeenCalledTimes(1);

    const tenantRepository = repositoryStub();
    const tenantService = createInternalOrgStructureService(
      serviceOptions({
        repository: tenantRepository,
        scopes: [{ type: "tenant" }]
      })
    );

    await expect(
      tenantService.upsertOrgUnit(context, {
        name: "Root org",
        kind: "department",
        status: "active"
      })
    ).resolves.toMatchObject({ parentOrgUnitId: null, name: "Root org" });
    await expect(
      tenantService.upsertWorkQueue(context, {
        name: "Unowned queue",
        kind: "custom",
        status: "active",
        routingConfig: {}
      })
    ).resolves.toMatchObject({
      owningOrgUnitId: null,
      name: "Unowned queue"
    });
  });

  it("requires target, current parent and destination scopes to reparent an org unit", async () => {
    const repository = repositoryStub({
      orgUnits: [rootOrgUnit, salesOrgUnit, claimsOrgUnit, salesChildOrgUnit]
    });
    const deniedService = createInternalOrgStructureService(
      serviceOptions({
        repository,
        scopes: [orgScope("org-sales-child"), orgScope("org-sales")]
      })
    );
    const request = {
      id: "org-sales-child",
      parentOrgUnitId: "org-claims",
      name: "Sales child",
      kind: "department" as const,
      status: "active" as const
    };

    await expect(deniedService.upsertOrgUnit(context, request)).rejects.toEqual(
      new CoreError("permission.denied")
    );
    expect(repository.upsertOrgUnit).not.toHaveBeenCalled();

    const allowedService = createInternalOrgStructureService(
      serviceOptions({
        repository,
        scopes: [
          orgScope("org-sales-child"),
          orgScope("org-sales"),
          orgScope("org-claims")
        ]
      })
    );

    await expect(
      allowedService.upsertOrgUnit(context, request)
    ).resolves.toMatchObject({
      id: "org-sales-child",
      parentOrgUnitId: "org-claims"
    });
    expect(repository.upsertOrgUnit).toHaveBeenCalledWith({
      id: "org-sales-child",
      tenantId,
      parentOrgUnitId: "org-claims",
      name: "Sales child",
      kind: "department",
      status: "active",
      updatedAt: now
    });
  });

  it("requires current owner and destination scopes to move a work queue", async () => {
    const repository = repositoryStub({
      orgUnits: [salesOrgUnit, claimsOrgUnit],
      workQueues: [salesQueue]
    });
    const deniedService = createInternalOrgStructureService(
      serviceOptions({
        repository,
        scopes: [orgScope("org-sales")]
      })
    );
    const request = {
      id: "queue-sales",
      name: "Sales queue",
      kind: "sales" as const,
      owningOrgUnitId: "org-claims",
      status: "active" as const,
      routingConfig: {}
    };

    await expect(
      deniedService.upsertWorkQueue(context, request)
    ).rejects.toEqual(new CoreError("permission.denied"));
    expect(repository.upsertWorkQueue).not.toHaveBeenCalled();

    const allowedService = createInternalOrgStructureService(
      serviceOptions({
        repository,
        scopes: [orgScope("org-sales"), orgScope("org-claims")]
      })
    );

    await expect(
      allowedService.upsertWorkQueue(context, request)
    ).resolves.toMatchObject({
      id: "queue-sales",
      owningOrgUnitId: "org-claims"
    });
    expect(repository.upsertWorkQueue).toHaveBeenCalledWith({
      id: "queue-sales",
      tenantId,
      name: "Sales queue",
      kind: "sales",
      owningOrgUnitId: "org-claims",
      status: "active",
      routingConfig: {},
      updatedAt: now
    });
  });

  it("rejects a deactivated actor before an org structure mutation", async () => {
    const repository = repositoryStub({ orgUnits: [salesOrgUnit] });
    const service = createInternalOrgStructureService(
      serviceOptions({
        repository,
        scopes: [{ type: "tenant" }],
        actor: employee({ deactivatedAt: now })
      })
    );

    await expect(
      service.upsertOrgUnit(context, {
        parentOrgUnitId: "org-sales",
        name: "Blocked child",
        kind: "department",
        status: "active"
      })
    ).rejects.toEqual(new CoreError("permission.denied"));
    expect(repository.upsertOrgUnit).not.toHaveBeenCalled();
  });
});

function serviceOptions(input: {
  repository: OrgStructureRepository;
  scopes: readonly PermissionScope[];
  actor?: TenantEmployeeRecord | null;
}): InternalOrgStructureServiceOptions {
  const actor = input.actor === undefined ? employee() : input.actor;

  return {
    repository: input.repository,
    employeeRepository: {
      findEmployee: vi.fn(async (request) =>
        actor !== null &&
        actor.tenantId === request.tenantId &&
        actor.employeeId === request.employeeId
          ? actor
          : null
      )
    },
    rbacRepository: {
      listEffectiveAccessSources: vi.fn(async () => ({
        roles: [
          {
            id: "role-org-manager",
            tenantId,
            permissions: ["employees.manage"] as const,
            status: "active" as const
          }
        ],
        roleBindings: input.scopes.map(
          (scope, index): PermissionRoleBinding => ({
            id: `binding-${index}`,
            tenantId,
            roleId: "role-org-manager",
            subject: {
              type: "employee",
              id: employeeId
            },
            scope
          })
        ),
        directGrants: []
      }))
    },
    now: () => now,
    idFactory: () => "generated"
  };
}

function employee(input?: {
  deactivatedAt?: Date | null;
}): TenantEmployeeRecord {
  return {
    tenantId,
    employeeId,
    accountId: null,
    email: "employee-1@example.test",
    displayName: "Employee 1",
    phoneNumber: null,
    avatarUrl: null,
    avatar: null,
    systemRoleTemplateIds: [],
    teamIds: [],
    orgUnitIds: [],
    queueIds: [],
    createdAt: now,
    deactivatedAt: input?.deactivatedAt ?? null
  };
}

function orgScope(id: string): PermissionScope {
  return {
    type: "org_unit",
    id
  };
}

function orgUnit(input: {
  id: string;
  parentOrgUnitId: string | null;
  name: string;
}): OrgUnitRecord {
  return {
    id: input.id,
    tenantId,
    parentOrgUnitId: input.parentOrgUnitId,
    name: input.name,
    kind: "department",
    status: "active"
  };
}

function workQueue(input: {
  id: string;
  owningOrgUnitId: string | null;
  name: string;
}): WorkQueueRecord {
  return {
    id: input.id,
    tenantId,
    name: input.name,
    kind: "custom",
    owningOrgUnitId: input.owningOrgUnitId,
    status: "active",
    routingConfig: {}
  };
}

function repositoryStub(input?: {
  orgUnits?: Awaited<ReturnType<OrgStructureRepository["listOrgUnits"]>>;
  teams?: Awaited<ReturnType<OrgStructureRepository["listTeams"]>>;
  workQueues?: Awaited<ReturnType<OrgStructureRepository["listWorkQueues"]>>;
}): OrgStructureRepository {
  const orgUnits = input?.orgUnits ?? [];
  const teams = input?.teams ?? [];
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
    upsertTeam: vi.fn(async (request) => ({
      id: request.id,
      tenantId: request.tenantId,
      name: request.name
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
    listTeams: vi.fn(async () => teams),
    listWorkQueues: vi.fn(async () => workQueues),
    setEmployeeOrgUnitMemberships: vi.fn(async () => undefined),
    setEmployeeTeamMemberships: vi.fn(async () => undefined),
    setEmployeeWorkQueueMemberships: vi.fn(async () => undefined)
  };
}
