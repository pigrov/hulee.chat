"use server";

import type { EmployeeId, TenantId } from "@hulee/contracts";
import {
  createSqlEmployeeDirectoryRepository,
  createSqlOrgStructureRepository,
  createSqlSecurityAuditRepository,
  type OrgStructureAuditAction
} from "@hulee/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";

import { assertWebActionRequest } from "./action-security";
import {
  assertCurrentWebTenantPermission,
  getWebDatabase,
  isEmailNotVerifiedError
} from "./session";

export async function setEmployeeOrgUnitMembershipsAction(
  formData: FormData
): Promise<void> {
  await assertWebActionRequest();

  const employeeId = readRequiredFormString(
    formData,
    "employeeId"
  ) as EmployeeId;
  const session = await assertVerifiedRolesPermission(employeeId);
  const now = new Date();
  let destination = employeeAccessDestination(formData, employeeId, "invalid");

  try {
    const repository = createSqlOrgStructureRepository(getWebDatabase());
    const employeeRepository =
      createSqlEmployeeDirectoryRepository(getWebDatabase());
    const orgUnitIds = uniqueFormStringList(formData, "orgUnitId");
    const [employee, orgUnits] = await Promise.all([
      employeeRepository.findEmployee({
        tenantId: session.tenantId,
        employeeId
      }),
      repository.listOrgUnits({
        tenantId: session.tenantId,
        activeOnly: true
      })
    ]);

    assertActiveEmployee(employee);
    assertKnownIds(
      orgUnitIds,
      orgUnits.map((orgUnit) => orgUnit.id)
    );

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
        orgUnitIds
      },
      occurredAt: now
    });

    destination = employeeAccessDestination(
      formData,
      employeeId,
      "memberships_updated"
    );
  } catch {
    destination = employeeAccessDestination(formData, employeeId, "invalid");
  }

  revalidateEmployeeAccessPaths();
  redirect(destination);
}

export async function setEmployeeWorkQueueMembershipsAction(
  formData: FormData
): Promise<void> {
  await assertWebActionRequest();

  const employeeId = readRequiredFormString(
    formData,
    "employeeId"
  ) as EmployeeId;
  const session = await assertVerifiedRolesPermission(employeeId);
  const now = new Date();
  let destination = employeeAccessDestination(formData, employeeId, "invalid");

  try {
    const repository = createSqlOrgStructureRepository(getWebDatabase());
    const employeeRepository =
      createSqlEmployeeDirectoryRepository(getWebDatabase());
    const workQueueIds = uniqueFormStringList(formData, "workQueueId");
    const [employee, workQueues] = await Promise.all([
      employeeRepository.findEmployee({
        tenantId: session.tenantId,
        employeeId
      }),
      repository.listWorkQueues({
        tenantId: session.tenantId,
        activeOnly: true
      })
    ]);

    assertActiveEmployee(employee);
    assertKnownIds(
      workQueueIds,
      workQueues.map((workQueue) => workQueue.id)
    );

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
        workQueueIds
      },
      occurredAt: now
    });

    destination = employeeAccessDestination(
      formData,
      employeeId,
      "memberships_updated"
    );
  } catch {
    destination = employeeAccessDestination(formData, employeeId, "invalid");
  }

  revalidateEmployeeAccessPaths();
  redirect(destination);
}

export async function setEmployeeTeamMembershipsAction(
  formData: FormData
): Promise<void> {
  await assertWebActionRequest();

  const employeeId = readRequiredFormString(
    formData,
    "employeeId"
  ) as EmployeeId;
  const session = await assertVerifiedRolesPermission(employeeId);
  const now = new Date();
  let destination = employeeAccessDestination(formData, employeeId, "invalid");

  try {
    const repository = createSqlOrgStructureRepository(getWebDatabase());
    const employeeRepository =
      createSqlEmployeeDirectoryRepository(getWebDatabase());
    const teamIds = uniqueFormStringList(formData, "teamId");
    const [employee, teams] = await Promise.all([
      employeeRepository.findEmployee({
        tenantId: session.tenantId,
        employeeId
      }),
      repository.listTeams({
        tenantId: session.tenantId
      })
    ]);

    assertActiveEmployee(employee);
    assertKnownIds(
      teamIds,
      teams.map((team) => team.id)
    );

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
        teamIds
      },
      occurredAt: now
    });

    destination = employeeAccessDestination(
      formData,
      employeeId,
      "memberships_updated"
    );
  } catch {
    destination = employeeAccessDestination(formData, employeeId, "invalid");
  }

  revalidateEmployeeAccessPaths();
  redirect(destination);
}

async function assertVerifiedRolesPermission(
  employeeId: EmployeeId
): ReturnType<typeof assertCurrentWebTenantPermission> {
  try {
    return await assertCurrentWebTenantPermission("roles.manage", {
      requireVerifiedEmail: true
    });
  } catch (error) {
    if (isEmailNotVerifiedError(error)) {
      redirect(
        `${employeeAccessPath(employeeId)}?roleActionStatus=email_verification_required`
      );
    }

    throw error;
  }
}

function assertActiveEmployee(
  employee: { readonly deactivatedAt: Date | null } | null
): void {
  if (employee === null || employee.deactivatedAt !== null) {
    throw new Error("Employee is not active.");
  }
}

function assertKnownIds(
  selectedIds: readonly string[],
  knownIds: readonly string[]
): void {
  const knownIdSet = new Set(knownIds);

  for (const selectedId of selectedIds) {
    if (!knownIdSet.has(selectedId)) {
      throw new Error("Membership reference is not available.");
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

function employeeAccessDestination(
  formData: FormData,
  employeeId: EmployeeId,
  status: string
): string {
  const returnTo = readOptionalFormString(formData, "returnTo");
  const path =
    returnTo === employeeAccessPath(employeeId)
      ? returnTo
      : employeeAccessPath(employeeId);

  return `${path}?roleActionStatus=${encodeURIComponent(status)}`;
}

function employeeAccessPath(employeeId: EmployeeId): string {
  return `/admin/employees/${encodeURIComponent(employeeId)}/access`;
}

function readRequiredFormString(formData: FormData, name: string): string {
  const value = formData.get(name);

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Form field ${name} is required.`);
  }

  return value.trim();
}

function readOptionalFormString(
  formData: FormData,
  name: string
): string | undefined {
  const value = formData.get(name);

  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
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
