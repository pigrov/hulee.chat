import type { EmployeeId, TenantId } from "@hulee/contracts";
import type { PermissionScope } from "@hulee/core";
import type {
  OrgUnitRecord,
  TeamRecord,
  TenantEmployeeRecord,
  WorkQueueRecord
} from "@hulee/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { initialOrgStructureActionState } from "./org-structure-action-state";

const mocks = vi.hoisted(() => ({
  assertWebActionRequest: vi.fn(),
  assertWebDbBackedAdminCommandBoundary: vi.fn(),
  createSqlEmployeeDirectoryRepository: vi.fn(),
  createSqlOrgStructureRepository: vi.fn(),
  createSqlSecurityAuditRepository: vi.fn(),
  createSqlTenantRbacRepository: vi.fn(),
  findEmployee: vi.fn(),
  getWebDatabase: vi.fn(),
  isEmailNotVerifiedError: vi.fn(),
  listEffectiveAccessSources: vi.fn(),
  listOrgUnits: vi.fn(),
  listTeams: vi.fn(),
  listWorkQueues: vi.fn(),
  recordAudit: vi.fn(),
  revalidatePath: vi.fn(),
  upsertOrgUnit: vi.fn(),
  upsertTeam: vi.fn(),
  upsertWorkQueue: vi.fn()
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath
}));

vi.mock("./action-security", () => ({
  assertWebActionRequest: mocks.assertWebActionRequest
}));

vi.mock("./session", () => ({
  getWebDatabase: mocks.getWebDatabase,
  isEmailNotVerifiedError: mocks.isEmailNotVerifiedError
}));

vi.mock("./web-admin-command-boundary", () => ({
  assertWebDbBackedAdminCommandBoundary:
    mocks.assertWebDbBackedAdminCommandBoundary,
  webDbBackedAdminCommandBoundaries: {
    orgStructure: {
      requireVerifiedEmail: true,
      requireRecentSession: false
    }
  }
}));

vi.mock("@hulee/db", () => ({
  createSqlEmployeeDirectoryRepository:
    mocks.createSqlEmployeeDirectoryRepository,
  createSqlOrgStructureRepository: mocks.createSqlOrgStructureRepository,
  createSqlSecurityAuditRepository: mocks.createSqlSecurityAuditRepository,
  createSqlTenantRbacRepository: mocks.createSqlTenantRbacRepository,
  orgStructureStatuses: ["active", "archived"],
  orgUnitKinds: ["department", "branch", "region", "custom"],
  workQueueKinds: ["sales", "support", "claims", "custom"]
}));

const tenantId = "tenant-test" as TenantId;
const employeeId = "employee-admin" as EmployeeId;
const salesOrgUnit = orgUnit("org-sales", null);
const claimsOrgUnit = orgUnit("org-claims", null);
const salesChildOrgUnit = orgUnit("org-sales-child", "org-sales");
const salesQueue = workQueue("queue-sales", "org-sales");
const salesTeam = team("team-sales");
const claimsTeam = team("team-claims");

describe("org structure actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.assertWebActionRequest.mockResolvedValue(undefined);
    mocks.assertWebDbBackedAdminCommandBoundary.mockResolvedValue({
      tenantId,
      tenantSlug: "local",
      employeeId,
      sessionCreatedAt: new Date().toISOString(),
      systemRoleTemplateIds: [],
      permissions: [],
      platformRoles: []
    });
    mocks.getWebDatabase.mockReturnValue({ kind: "database" });
    mocks.isEmailNotVerifiedError.mockReturnValue(false);
    mocks.createSqlEmployeeDirectoryRepository.mockReturnValue({
      findEmployee: mocks.findEmployee
    });
    mocks.createSqlTenantRbacRepository.mockReturnValue({
      listEffectiveAccessSources: mocks.listEffectiveAccessSources
    });
    mocks.createSqlOrgStructureRepository.mockReturnValue({
      listOrgUnits: mocks.listOrgUnits,
      listTeams: mocks.listTeams,
      listWorkQueues: mocks.listWorkQueues,
      upsertOrgUnit: mocks.upsertOrgUnit,
      upsertTeam: mocks.upsertTeam,
      upsertWorkQueue: mocks.upsertWorkQueue
    });
    mocks.createSqlSecurityAuditRepository.mockReturnValue({
      record: mocks.recordAudit
    });
    mocks.findEmployee.mockResolvedValue(employee());
    setScopes([{ type: "tenant" }]);
    mocks.listOrgUnits.mockResolvedValue([]);
    mocks.listTeams.mockResolvedValue([]);
    mocks.listWorkQueues.mockResolvedValue([]);
    mocks.upsertOrgUnit.mockImplementation(async (request) => ({
      id: request.id,
      tenantId: request.tenantId,
      parentOrgUnitId: request.parentOrgUnitId ?? null,
      name: request.name,
      kind: request.kind,
      status: request.status ?? "active"
    }));
    mocks.upsertTeam.mockImplementation(async (request) => ({
      id: request.id,
      tenantId: request.tenantId,
      name: request.name
    }));
    mocks.upsertWorkQueue.mockImplementation(async (request) => ({
      id: request.id,
      tenantId: request.tenantId,
      name: request.name,
      kind: request.kind,
      owningOrgUnitId: request.owningOrgUnitId ?? null,
      status: request.status ?? "active",
      routingConfig: request.routingConfig ?? {}
    }));
    mocks.recordAudit.mockResolvedValue(undefined);
  });

  it("keeps root org, Team and unowned Queue creation for a DB-backed tenant manager", async () => {
    const { upsertOrgUnitAction, upsertTeamAction, upsertWorkQueueAction } =
      await import("./org-structure-actions");

    await expectActionSuccess(
      upsertOrgUnitAction(
        initialOrgStructureActionState,
        formData({ name: "Root", kind: "department" })
      ),
      "org_unit_saved"
    );
    await expectActionSuccess(
      upsertTeamAction(
        initialOrgStructureActionState,
        formData({ name: "Sales team" })
      ),
      "team_saved"
    );
    await expectActionSuccess(
      upsertWorkQueueAction(
        initialOrgStructureActionState,
        formData({ name: "Unowned", kind: "custom" })
      ),
      "work_queue_saved"
    );

    expect(mocks.assertWebDbBackedAdminCommandBoundary).toHaveBeenCalledWith({
      requireVerifiedEmail: true,
      requireRecentSession: false
    });
    expect(mocks.upsertOrgUnit).toHaveBeenCalledOnce();
    expect(mocks.upsertTeam).toHaveBeenCalledOnce();
    expect(mocks.upsertWorkQueue).toHaveBeenCalledOnce();
    expect(mocks.recordAudit).toHaveBeenCalledTimes(3);
    expect(mocks.recordAudit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        metadata: expect.objectContaining({
          authorizationScopes: [
            { type: "org_unit", id: expect.any(String) },
            { type: "tenant" }
          ]
        })
      })
    );
    expect(mocks.recordAudit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        metadata: expect.objectContaining({
          authorizationScopes: [
            { type: "team", id: expect.any(String) },
            { type: "tenant" }
          ]
        })
      })
    );
    expect(mocks.recordAudit).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        metadata: expect.objectContaining({
          authorizationScopes: [
            { type: "queue", id: expect.any(String) },
            { type: "tenant" }
          ]
        })
      })
    );
  }, 10_000);

  it("allows scoped creates under an exact org but denies root, Team and unowned creates without writes or audit", async () => {
    setScopes([{ type: "org_unit", id: "org-sales" }]);
    mocks.listOrgUnits.mockResolvedValue([salesOrgUnit]);
    const { upsertOrgUnitAction, upsertTeamAction, upsertWorkQueueAction } =
      await import("./org-structure-actions");

    await expectActionSuccess(
      upsertOrgUnitAction(
        initialOrgStructureActionState,
        formData({
          name: "Sales child",
          kind: "department",
          parentOrgUnitId: "org-sales"
        })
      ),
      "org_unit_saved"
    );
    await expectActionSuccess(
      upsertWorkQueueAction(
        initialOrgStructureActionState,
        formData({
          name: "Sales queue",
          kind: "sales",
          owningOrgUnitId: "org-sales"
        })
      ),
      "work_queue_saved"
    );
    const allowedAuditCalls = mocks.recordAudit.mock.calls.length;

    expect(mocks.recordAudit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        metadata: expect.objectContaining({
          authorizationScopes: [
            { type: "org_unit", id: expect.any(String) },
            { type: "org_unit", id: "org-sales" }
          ]
        })
      })
    );
    expect(mocks.recordAudit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        metadata: expect.objectContaining({
          authorizationScopes: [
            { type: "queue", id: expect.any(String) },
            { type: "org_unit", id: "org-sales" }
          ]
        })
      })
    );

    await expectActionInvalid(
      upsertOrgUnitAction(
        initialOrgStructureActionState,
        formData({ name: "Root", kind: "department" })
      )
    );
    await expectActionInvalid(
      upsertTeamAction(
        initialOrgStructureActionState,
        formData({ name: "Forbidden team" })
      )
    );
    await expectActionInvalid(
      upsertWorkQueueAction(
        initialOrgStructureActionState,
        formData({ name: "Unowned", kind: "custom" })
      )
    );

    expect(mocks.upsertOrgUnit).toHaveBeenCalledTimes(1);
    expect(mocks.upsertTeam).not.toHaveBeenCalled();
    expect(mocks.upsertWorkQueue).toHaveBeenCalledTimes(1);
    expect(mocks.recordAudit).toHaveBeenCalledTimes(allowedAuditCalls);
  });

  it("denies reparenting without the destination grant before write and audit", async () => {
    setScopes([
      { type: "org_unit", id: "org-sales-child" },
      { type: "org_unit", id: "org-sales" }
    ]);
    mocks.listOrgUnits.mockResolvedValue([
      salesOrgUnit,
      claimsOrgUnit,
      salesChildOrgUnit
    ]);
    const { moveOrgUnitParentAction } = await import("./org-structure-actions");

    await expect(
      moveOrgUnitParentAction(
        formData({ id: "org-sales-child", parentOrgUnitId: "org-claims" })
      )
    ).resolves.toEqual({ status: "invalid" });
    expect(mocks.upsertOrgUnit).not.toHaveBeenCalled();
    expect(mocks.createSqlSecurityAuditRepository).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("moves an org only when target, current parent and destination all match", async () => {
    setScopes([
      { type: "org_unit", id: "org-sales-child" },
      { type: "org_unit", id: "org-sales" },
      { type: "org_unit", id: "org-claims" }
    ]);
    mocks.listOrgUnits.mockResolvedValue([
      salesOrgUnit,
      claimsOrgUnit,
      salesChildOrgUnit
    ]);
    const { moveOrgUnitParentAction } = await import("./org-structure-actions");

    await expect(
      moveOrgUnitParentAction(
        formData({ id: "org-sales-child", parentOrgUnitId: "org-claims" })
      )
    ).resolves.toEqual({ status: "saved" });
    expect(mocks.upsertOrgUnit).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "org-sales-child",
        parentOrgUnitId: "org-claims"
      })
    );
    expect(mocks.recordAudit).toHaveBeenCalledOnce();
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          authorizationScopes: [
            { type: "org_unit", id: "org-sales-child" },
            { type: "org_unit", id: "org-sales" },
            { type: "org_unit", id: "org-claims" }
          ]
        })
      })
    );
  });

  it("preserves a canonical hidden parent during an ordinary org update", async () => {
    setScopes([{ type: "org_unit", id: "org-sales-child" }]);
    mocks.listOrgUnits.mockResolvedValue([salesOrgUnit, salesChildOrgUnit]);
    const { upsertOrgUnitAction } = await import("./org-structure-actions");

    await expectActionSuccess(
      upsertOrgUnitAction(
        initialOrgStructureActionState,
        formData({
          id: "org-sales-child",
          name: "Renamed child",
          kind: "department"
        })
      ),
      "org_unit_saved"
    );
    expect(mocks.upsertOrgUnit).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "org-sales-child",
        parentOrgUnitId: "org-sales",
        name: "Renamed child"
      })
    );
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          authorizationScopes: [
            { type: "org_unit", id: "org-sales-child" },
            { type: "org_unit", id: "org-sales" }
          ]
        })
      })
    );
  });

  it("denies a Queue owner transfer without the destination grant before write and audit", async () => {
    setScopes([{ type: "org_unit", id: "org-sales" }]);
    mocks.listOrgUnits.mockResolvedValue([salesOrgUnit, claimsOrgUnit]);
    mocks.listWorkQueues.mockResolvedValue([salesQueue]);
    const { upsertWorkQueueAction } = await import("./org-structure-actions");

    await expectActionInvalid(
      upsertWorkQueueAction(
        initialOrgStructureActionState,
        formData({
          id: "queue-sales",
          name: "Sales queue",
          kind: "sales",
          owningOrgUnitId: "org-claims"
        })
      )
    );
    expect(mocks.upsertWorkQueue).not.toHaveBeenCalled();
    expect(mocks.createSqlSecurityAuditRepository).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("preserves an existing Queue owner when a normal update omits it", async () => {
    mocks.listOrgUnits.mockResolvedValue([salesOrgUnit]);
    mocks.listWorkQueues.mockResolvedValue([salesQueue]);
    const { upsertWorkQueueAction } = await import("./org-structure-actions");

    await expectActionSuccess(
      upsertWorkQueueAction(
        initialOrgStructureActionState,
        formData({
          id: "queue-sales",
          name: "Renamed queue",
          kind: "sales"
        })
      ),
      "work_queue_saved"
    );
    expect(mocks.upsertWorkQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "queue-sales",
        owningOrgUnitId: "org-sales",
        name: "Renamed queue"
      })
    );
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          authorizationScopes: [
            { type: "queue", id: "queue-sales" },
            { type: "org_unit", id: "org-sales" }
          ]
        })
      })
    );
  });

  it("requires tenant scope for an explicit transfer to unowned", async () => {
    setScopes([{ type: "org_unit", id: "org-sales" }]);
    mocks.listOrgUnits.mockResolvedValue([salesOrgUnit]);
    mocks.listWorkQueues.mockResolvedValue([salesQueue]);
    const { upsertWorkQueueAction } = await import("./org-structure-actions");
    const request = formData({
      id: "queue-sales",
      name: "Sales queue",
      kind: "sales",
      owningOrgUnitIntent: "unowned"
    });

    await expectActionInvalid(
      upsertWorkQueueAction(initialOrgStructureActionState, request)
    );
    expect(mocks.upsertWorkQueue).not.toHaveBeenCalled();
    expect(mocks.createSqlSecurityAuditRepository).not.toHaveBeenCalled();

    setScopes([{ type: "tenant" }]);
    await expectActionSuccess(
      upsertWorkQueueAction(
        initialOrgStructureActionState,
        formData({
          id: "queue-sales",
          name: "Sales queue",
          kind: "sales",
          owningOrgUnitIntent: "unowned"
        })
      ),
      "work_queue_saved"
    );
    expect(mocks.upsertWorkQueue).toHaveBeenCalledWith(
      expect.objectContaining({ owningOrgUnitId: null })
    );
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          authorizationScopes: [
            { type: "queue", id: "queue-sales" },
            { type: "org_unit", id: "org-sales" },
            { type: "tenant" }
          ]
        })
      })
    );
  });

  it("records exact targets and canonical anchors for status events", async () => {
    mocks.listOrgUnits.mockResolvedValue([salesOrgUnit, salesChildOrgUnit]);
    mocks.listWorkQueues.mockResolvedValue([salesQueue]);
    const { setOrgUnitStatusAction, setWorkQueueStatusAction } =
      await import("./org-structure-actions");

    await expectActionSuccess(
      setOrgUnitStatusAction(
        initialOrgStructureActionState,
        formData({ id: "org-sales-child", status: "archived" })
      ),
      "org_unit_archived"
    );
    await expectActionSuccess(
      setWorkQueueStatusAction(
        initialOrgStructureActionState,
        formData({ id: "queue-sales", status: "archived" })
      ),
      "work_queue_archived"
    );

    expect(mocks.recordAudit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        metadata: expect.objectContaining({
          authorizationScopes: [
            { type: "org_unit", id: "org-sales-child" },
            { type: "org_unit", id: "org-sales" }
          ]
        })
      })
    );
    expect(mocks.recordAudit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        metadata: expect.objectContaining({
          authorizationScopes: [
            { type: "queue", id: "queue-sales" },
            { type: "org_unit", id: "org-sales" }
          ]
        })
      })
    );
  });

  it("allows only an exact Team update for a team-scoped manager", async () => {
    setScopes([{ type: "team", id: "team-sales" }]);
    mocks.listTeams.mockResolvedValue([salesTeam, claimsTeam]);
    const { upsertTeamAction } = await import("./org-structure-actions");

    await expectActionSuccess(
      upsertTeamAction(
        initialOrgStructureActionState,
        formData({ id: "team-sales", name: "Sales renamed" })
      ),
      "team_saved"
    );
    await expectActionInvalid(
      upsertTeamAction(
        initialOrgStructureActionState,
        formData({ id: "team-claims", name: "Forbidden" })
      )
    );
    await expectActionInvalid(
      upsertTeamAction(
        initialOrgStructureActionState,
        formData({ name: "New team" })
      )
    );

    expect(mocks.upsertTeam).toHaveBeenCalledOnce();
    expect(mocks.recordAudit).toHaveBeenCalledOnce();
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          authorizationScopes: [{ type: "team", id: "team-sales" }]
        })
      })
    );
  });
});

function setScopes(scopes: readonly PermissionScope[]): void {
  mocks.listEffectiveAccessSources.mockResolvedValue({
    roles: [],
    roleBindings: [],
    directGrants: scopes.map((scope, index) => ({
      id: `grant-${index}`,
      tenantId,
      employeeId,
      permission: "employees.manage" as const,
      scope,
      reason: "test"
    }))
  });
}

function employee(): TenantEmployeeRecord {
  return {
    tenantId,
    employeeId,
    accountId: null,
    email: "employee@example.test",
    displayName: "Employee",
    phoneNumber: null,
    avatarUrl: null,
    avatar: null,
    systemRoleTemplateIds: [],
    teamIds: [],
    orgUnitIds: [],
    queueIds: [],
    createdAt: new Date("2026-07-13T10:00:00.000Z"),
    deactivatedAt: null
  };
}

function orgUnit(id: string, parentOrgUnitId: string | null): OrgUnitRecord {
  return {
    id,
    tenantId,
    parentOrgUnitId,
    name: id,
    kind: "department",
    status: "active"
  };
}

function team(id: string): TeamRecord {
  return { id, tenantId, name: id };
}

function workQueue(
  id: string,
  owningOrgUnitId: string | null
): WorkQueueRecord {
  return {
    id,
    tenantId,
    name: id,
    kind: "sales",
    owningOrgUnitId,
    status: "active",
    routingConfig: {}
  };
}

function formData(fields: Record<string, string>): FormData {
  const data = new FormData();

  for (const [key, value] of Object.entries(fields)) {
    data.set(key, value);
  }

  return data;
}

async function expectActionSuccess(
  promise: ReturnType<
    (typeof import("./org-structure-actions"))["upsertOrgUnitAction"]
  >,
  code: string
): Promise<void> {
  const result = await promise;

  expect(result).toMatchObject({ status: "success", code });
}

async function expectActionInvalid(
  promise: ReturnType<
    (typeof import("./org-structure-actions"))["upsertOrgUnitAction"]
  >
): Promise<void> {
  const result = await promise;

  expect(result).toMatchObject({ status: "error", code: "invalid" });
}
