"use server";

import type { EmployeeId, TenantId } from "@hulee/contracts";
import {
  CoreError,
  resolveEffectivePermissionGrants,
  type EffectivePermissionGrant,
  type PermissionActor
} from "@hulee/core";
import {
  createSqlEmployeeDirectoryRepository,
  createSqlOrgStructureRepository,
  createSqlSecurityAuditRepository,
  createSqlTenantRbacRepository,
  type OrgStructureAuditAction,
  type OrgUnitRecord,
  type TeamRecord,
  type TenantEmployeeRecord,
  type WorkQueueRecord
} from "@hulee/db";
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";

import { assertWebActionRequest } from "./action-security";
import type { WebAccessSession } from "./access";
import { type EmployeeMembershipActionState } from "./employee-membership-action-state";
import {
  assertCanManageEmployeeMembershipTarget,
  assertCanUpdateEmployeeMemberships,
  type EmployeeMembershipAccessResource
} from "./employee-membership-access";
import { roleActionFailureStatus } from "./role-action-status";
import { getWebDatabase, isEmailNotVerifiedError } from "./session";
import {
  assertWebDbBackedAdminCommandBoundary,
  webDbBackedAdminCommandBoundaries
} from "./web-admin-command-boundary";

export async function setEmployeeOrgUnitMembershipsAction(
  _previousState: EmployeeMembershipActionState,
  formData: FormData
): Promise<EmployeeMembershipActionState> {
  await assertWebActionRequest();
  const submittedAt = new Date().toISOString();

  try {
    const employeeId = readRequiredFormString(
      formData,
      "employeeId"
    ) as EmployeeId;
    const session = await assertVerifiedMembershipSession();
    const now = new Date();
    const database = getWebDatabase();
    const repository = createSqlOrgStructureRepository(database);
    const employeeRepository = createSqlEmployeeDirectoryRepository(database);
    const rbacRepository = createSqlTenantRbacRepository(database);
    const orgUnitIds = uniqueFormStringList(formData, "orgUnitId");
    const [
      employee,
      orgUnits,
      teams,
      workQueues,
      actorPrivilege,
      roles,
      roleBindings
    ] = await Promise.all([
      employeeRepository.findEmployee({
        tenantId: session.tenantId,
        employeeId
      }),
      repository.listOrgUnits({
        tenantId: session.tenantId,
        activeOnly: false
      }),
      repository.listTeams({
        tenantId: session.tenantId
      }),
      repository.listWorkQueues({
        tenantId: session.tenantId,
        activeOnly: false
      }),
      resolveMembershipActorPrivilege({
        session,
        employeeRepository,
        rbacRepository,
        now
      }),
      rbacRepository.listRoleDefinitions({ tenantId: session.tenantId }),
      rbacRepository.listCurrentAndScheduledRoleBindings({
        tenantId: session.tenantId,
        at: now
      })
    ]);

    assertActiveEmployee(employee);
    assertCanManageEmployeeMembershipTarget({
      ...actorPrivilege,
      target: employee
    });
    assertKnownIds(
      orgUnitIds,
      orgUnits
        .filter((orgUnit) => orgUnit.status === "active")
        .map((orgUnit) => orgUnit.id)
    );
    const authorizationScopes = assertCanUpdateEmployeeMemberships({
      ...actorPrivilege,
      target: employee,
      membershipType: "org_unit",
      previousIds: employee.orgUnitIds,
      nextIds: orgUnitIds,
      resources: structuralMembershipResources({
        orgUnits,
        teams,
        workQueues
      }),
      roleBindings,
      roles
    });

    if (sameMembershipIds(employee.orgUnitIds, orgUnitIds)) {
      return employeeMembershipActionSuccess(submittedAt);
    }

    await repository.setEmployeeOrgUnitMemberships({
      tenantId: session.tenantId,
      employeeId,
      orgUnitIds,
      updatedAt: now
    });

    await recordMembershipAudit({
      tenantId: session.tenantId,
      actorEmployeeId: session.employeeId,
      action: "employee_org_membership.updated",
      employeeId,
      metadata: {
        employeeId,
        orgUnitIds,
        authorizationScopes
      },
      occurredAt: now
    });

    revalidateEmployeeAccessPaths();

    return employeeMembershipActionSuccess(submittedAt);
  } catch (error) {
    return employeeMembershipActionError(error, submittedAt);
  }
}

export async function setEmployeeWorkQueueMembershipsAction(
  _previousState: EmployeeMembershipActionState,
  formData: FormData
): Promise<EmployeeMembershipActionState> {
  await assertWebActionRequest();
  const submittedAt = new Date().toISOString();

  try {
    const employeeId = readRequiredFormString(
      formData,
      "employeeId"
    ) as EmployeeId;
    const session = await assertVerifiedMembershipSession();
    const now = new Date();
    const database = getWebDatabase();
    const repository = createSqlOrgStructureRepository(database);
    const employeeRepository = createSqlEmployeeDirectoryRepository(database);
    const rbacRepository = createSqlTenantRbacRepository(database);
    const workQueueIds = uniqueFormStringList(formData, "workQueueId");
    const [
      employee,
      orgUnits,
      teams,
      workQueues,
      actorPrivilege,
      roles,
      roleBindings
    ] = await Promise.all([
      employeeRepository.findEmployee({
        tenantId: session.tenantId,
        employeeId
      }),
      repository.listOrgUnits({
        tenantId: session.tenantId,
        activeOnly: false
      }),
      repository.listTeams({
        tenantId: session.tenantId
      }),
      repository.listWorkQueues({
        tenantId: session.tenantId,
        activeOnly: false
      }),
      resolveMembershipActorPrivilege({
        session,
        employeeRepository,
        rbacRepository,
        now
      }),
      rbacRepository.listRoleDefinitions({ tenantId: session.tenantId }),
      rbacRepository.listCurrentAndScheduledRoleBindings({
        tenantId: session.tenantId,
        at: now
      })
    ]);

    assertActiveEmployee(employee);
    assertCanManageEmployeeMembershipTarget({
      ...actorPrivilege,
      target: employee
    });
    assertKnownIds(
      workQueueIds,
      workQueues
        .filter((workQueue) => workQueue.status === "active")
        .map((workQueue) => workQueue.id)
    );
    const authorizationScopes = assertCanUpdateEmployeeMemberships({
      ...actorPrivilege,
      target: employee,
      membershipType: "queue",
      previousIds: employee.queueIds,
      nextIds: workQueueIds,
      resources: structuralMembershipResources({
        orgUnits,
        teams,
        workQueues
      }),
      roleBindings,
      roles
    });

    if (sameMembershipIds(employee.queueIds, workQueueIds)) {
      return employeeMembershipActionSuccess(submittedAt);
    }

    await repository.setEmployeeWorkQueueMemberships({
      tenantId: session.tenantId,
      employeeId,
      workQueueIds,
      updatedAt: now
    });

    await recordMembershipAudit({
      tenantId: session.tenantId,
      actorEmployeeId: session.employeeId,
      action: "employee_queue_membership.updated",
      employeeId,
      metadata: {
        employeeId,
        workQueueIds,
        authorizationScopes
      },
      occurredAt: now
    });

    revalidateEmployeeAccessPaths();

    return employeeMembershipActionSuccess(submittedAt);
  } catch (error) {
    return employeeMembershipActionError(error, submittedAt);
  }
}

export async function setEmployeeTeamMembershipsAction(
  _previousState: EmployeeMembershipActionState,
  formData: FormData
): Promise<EmployeeMembershipActionState> {
  await assertWebActionRequest();
  const submittedAt = new Date().toISOString();

  try {
    const employeeId = readRequiredFormString(
      formData,
      "employeeId"
    ) as EmployeeId;
    const session = await assertVerifiedMembershipSession();
    const now = new Date();
    const database = getWebDatabase();
    const repository = createSqlOrgStructureRepository(database);
    const employeeRepository = createSqlEmployeeDirectoryRepository(database);
    const rbacRepository = createSqlTenantRbacRepository(database);
    const teamIds = uniqueFormStringList(formData, "teamId");
    const [
      employee,
      orgUnits,
      teams,
      workQueues,
      actorPrivilege,
      roles,
      roleBindings
    ] = await Promise.all([
      employeeRepository.findEmployee({
        tenantId: session.tenantId,
        employeeId
      }),
      repository.listOrgUnits({
        tenantId: session.tenantId,
        activeOnly: false
      }),
      repository.listTeams({
        tenantId: session.tenantId
      }),
      repository.listWorkQueues({
        tenantId: session.tenantId,
        activeOnly: false
      }),
      resolveMembershipActorPrivilege({
        session,
        employeeRepository,
        rbacRepository,
        now
      }),
      rbacRepository.listRoleDefinitions({ tenantId: session.tenantId }),
      rbacRepository.listCurrentAndScheduledRoleBindings({
        tenantId: session.tenantId,
        at: now
      })
    ]);

    assertActiveEmployee(employee);
    assertCanManageEmployeeMembershipTarget({
      ...actorPrivilege,
      target: employee
    });
    assertKnownIds(
      teamIds,
      teams.map((team) => team.id)
    );
    const authorizationScopes = assertCanUpdateEmployeeMemberships({
      ...actorPrivilege,
      target: employee,
      membershipType: "team",
      previousIds: employee.teamIds,
      nextIds: teamIds,
      resources: structuralMembershipResources({
        orgUnits,
        teams,
        workQueues
      }),
      roleBindings,
      roles
    });

    if (sameMembershipIds(employee.teamIds, teamIds)) {
      return employeeMembershipActionSuccess(submittedAt);
    }

    await repository.setEmployeeTeamMemberships({
      tenantId: session.tenantId,
      employeeId,
      teamIds,
      updatedAt: now
    });

    await recordMembershipAudit({
      tenantId: session.tenantId,
      actorEmployeeId: session.employeeId,
      action: "employee_team_membership.updated",
      employeeId,
      metadata: {
        employeeId,
        teamIds,
        authorizationScopes
      },
      occurredAt: now
    });

    revalidateEmployeeAccessPaths();

    return employeeMembershipActionSuccess(submittedAt);
  } catch (error) {
    return employeeMembershipActionError(error, submittedAt);
  }
}

async function assertVerifiedMembershipSession(): Promise<WebAccessSession> {
  return assertWebDbBackedAdminCommandBoundary(
    webDbBackedAdminCommandBoundaries.employeeMembership
  );
}

async function resolveMembershipActorPrivilege(input: {
  readonly session: WebAccessSession;
  readonly employeeRepository: ReturnType<
    typeof createSqlEmployeeDirectoryRepository
  >;
  readonly rbacRepository: ReturnType<typeof createSqlTenantRbacRepository>;
  readonly now: Date;
}): Promise<{
  readonly actor: PermissionActor;
  readonly effectiveGrants: readonly EffectivePermissionGrant[];
}> {
  const currentEmployee = await input.employeeRepository.findEmployee({
    tenantId: input.session.tenantId,
    employeeId: input.session.employeeId
  });

  assertActiveEmployee(currentEmployee);

  const actor = permissionActorFromEmployee(currentEmployee);
  const sources = await input.rbacRepository.listEffectiveAccessSources({
    actor,
    at: input.now
  });

  return {
    actor,
    effectiveGrants: resolveEffectivePermissionGrants({
      actor,
      roles: sources.roles,
      roleBindings: sources.roleBindings,
      directGrants: sources.directGrants,
      at: input.now
    })
  };
}

function permissionActorFromEmployee(
  employee: TenantEmployeeRecord
): PermissionActor {
  return {
    tenantId: employee.tenantId,
    employeeId: employee.employeeId,
    orgUnitIds: employee.orgUnitIds,
    queueIds: employee.queueIds,
    teamIds: employee.teamIds
  };
}

function orgUnitMembershipResources(
  orgUnits: readonly OrgUnitRecord[]
): readonly EmployeeMembershipAccessResource[] {
  return orgUnits.map((orgUnit) => ({
    type: "org_unit",
    id: orgUnit.id,
    resource: {
      tenantId: orgUnit.tenantId,
      orgUnitId: orgUnit.id,
      orgUnitIds: [orgUnit.id]
    }
  }));
}

function workQueueMembershipResources(
  workQueues: readonly WorkQueueRecord[]
): readonly EmployeeMembershipAccessResource[] {
  return workQueues.map((workQueue) => ({
    type: "queue",
    id: workQueue.id,
    resource: {
      tenantId: workQueue.tenantId,
      orgUnitId: workQueue.owningOrgUnitId ?? undefined,
      queueId: workQueue.id
    }
  }));
}

function teamMembershipResources(
  teams: readonly TeamRecord[]
): readonly EmployeeMembershipAccessResource[] {
  return teams.map((team) => ({
    type: "team",
    id: team.id,
    resource: {
      tenantId: team.tenantId,
      teamId: team.id,
      teamIds: [team.id]
    }
  }));
}

function structuralMembershipResources(input: {
  readonly orgUnits: readonly OrgUnitRecord[];
  readonly teams: readonly TeamRecord[];
  readonly workQueues: readonly WorkQueueRecord[];
}): readonly EmployeeMembershipAccessResource[] {
  return [
    ...orgUnitMembershipResources(input.orgUnits),
    ...teamMembershipResources(input.teams),
    ...workQueueMembershipResources(input.workQueues)
  ];
}

function sameMembershipIds(
  previousIds: readonly string[],
  nextIds: readonly string[]
): boolean {
  if (previousIds.length !== nextIds.length) {
    return false;
  }

  const nextIdSet = new Set(nextIds);

  return previousIds.every((id) => nextIdSet.has(id));
}

function assertActiveEmployee<
  TEmployee extends { readonly deactivatedAt: Date | null }
>(employee: TEmployee | null): asserts employee is TEmployee {
  if (employee === null || employee.deactivatedAt !== null) {
    throw new CoreError("permission.denied");
  }
}

function assertKnownIds(
  selectedIds: readonly string[],
  knownIds: readonly string[]
): void {
  const knownIdSet = new Set(knownIds);

  for (const selectedId of selectedIds) {
    if (!knownIdSet.has(selectedId)) {
      throw new CoreError("permission.denied");
    }
  }
}

async function recordMembershipAudit(input: {
  readonly tenantId: TenantId;
  readonly actorEmployeeId: EmployeeId;
  readonly action: OrgStructureAuditAction;
  readonly employeeId: EmployeeId;
  readonly metadata: Record<string, unknown>;
  readonly occurredAt: Date;
}): Promise<void> {
  await createSqlSecurityAuditRepository(getWebDatabase()).record({
    id: `audit:${input.tenantId}:${input.action}:${randomUUID()}`,
    tenantId: input.tenantId,
    actorEmployeeId: input.actorEmployeeId,
    action: input.action,
    entityType: "employee",
    entityId: input.employeeId,
    metadata: input.metadata,
    occurredAt: input.occurredAt
  });
}

function revalidateEmployeeAccessPaths(): void {
  revalidatePath("/admin");
  revalidatePath("/admin/employees");
  revalidatePath("/admin/employees/[employeeId]/access", "page");
  revalidatePath("/admin/roles");
}

function employeeMembershipActionSuccess(
  submittedAt: string
): EmployeeMembershipActionState {
  return {
    code: "memberships_updated",
    status: "success",
    submittedAt
  };
}

function employeeMembershipActionError(
  error: unknown,
  submittedAt: string
): EmployeeMembershipActionState {
  const code = isEmailNotVerifiedError(error)
    ? "email_verification_required"
    : roleActionFailureStatus(error);

  return {
    code,
    status: "error",
    submittedAt
  };
}

function readRequiredFormString(formData: FormData, name: string): string {
  const value = formData.get(name);

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Form field ${name} is required.`);
  }

  return value.trim();
}

function uniqueFormStringList(formData: FormData, name: string): string[] {
  const ids = formData
    .getAll(name)
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return [...new Set(ids)];
}
