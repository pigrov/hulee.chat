"use server";

import type { EmployeeId, TenantId } from "@hulee/contracts";
import {
  createSqlOrgStructureRepository,
  createSqlSecurityAuditRepository,
  orgStructureStatuses,
  orgUnitKinds,
  workQueueKinds,
  type OrgStructureAuditAction,
  type OrgStructureRepository,
  type OrgStructureStatus,
  type OrgUnitKind,
  type OrgUnitRecord,
  type TeamRecord,
  type WorkQueueKind,
  type WorkQueueRecord
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

export async function upsertOrgUnitAction(formData: FormData): Promise<void> {
  await assertWebActionRequest();

  const session = await assertVerifiedOrgStructurePermission();
  const repository = createSqlOrgStructureRepository(getWebDatabase());
  const now = new Date();
  let destination = orgStructureDestination("invalid");

  try {
    const requestedId = readOptionalFormString(formData, "id");
    const existing =
      requestedId === undefined
        ? undefined
        : await findOrgUnit(repository, session.tenantId, requestedId);

    if (requestedId !== undefined && existing === undefined) {
      throw new Error("Org unit not found.");
    }

    const id = existing?.id ?? `org_unit:${session.tenantId}:${randomUUID()}`;
    const orgUnit = await repository.upsertOrgUnit({
      id,
      tenantId: session.tenantId,
      parentOrgUnitId: readOptionalFormString(formData, "parentOrgUnitId"),
      name: readRequiredLimitedFormString(formData, "name", 120),
      kind: readOrgUnitKind(formData, "kind"),
      status: existing?.status ?? "active",
      updatedAt: now
    });
    const action: OrgStructureAuditAction =
      existing === undefined ? "org_unit.created" : "org_unit.updated";

    await recordOrgStructureAudit({
      tenantId: session.tenantId,
      actorEmployeeId: session.employeeId,
      action,
      entityType: "org_unit",
      entityId: orgUnit.id,
      metadata: {
        name: orgUnit.name,
        kind: orgUnit.kind,
        parentOrgUnitId: orgUnit.parentOrgUnitId,
        status: orgUnit.status
      },
      occurredAt: now
    });

    destination = orgStructureDestination("org_unit_saved");
  } catch {
    destination = orgStructureDestination("invalid");
  }

  revalidateOrgStructurePaths();
  redirect(destination);
}

export async function setOrgUnitStatusAction(
  formData: FormData
): Promise<void> {
  await assertWebActionRequest();

  const session = await assertVerifiedOrgStructurePermission();
  const repository = createSqlOrgStructureRepository(getWebDatabase());
  const now = new Date();
  let destination = orgStructureDestination("invalid");

  try {
    const id = readRequiredFormString(formData, "id");
    const status = readOrgStructureStatus(formData, "status");
    const existing = await findOrgUnit(repository, session.tenantId, id);

    if (existing === undefined) {
      throw new Error("Org unit not found.");
    }

    const orgUnit = await repository.upsertOrgUnit({
      id: existing.id,
      tenantId: session.tenantId,
      parentOrgUnitId: existing.parentOrgUnitId,
      name: existing.name,
      kind: existing.kind,
      status,
      updatedAt: now
    });
    const action: OrgStructureAuditAction =
      status === "active" ? "org_unit.restored" : "org_unit.archived";

    await recordOrgStructureAudit({
      tenantId: session.tenantId,
      actorEmployeeId: session.employeeId,
      action,
      entityType: "org_unit",
      entityId: orgUnit.id,
      metadata: {
        name: orgUnit.name,
        previousStatus: existing.status,
        nextStatus: orgUnit.status
      },
      occurredAt: now
    });

    destination = orgStructureDestination(
      status === "active" ? "org_unit_restored" : "org_unit_archived"
    );
  } catch {
    destination = orgStructureDestination("invalid");
  }

  revalidateOrgStructurePaths();
  redirect(destination);
}

export async function upsertTeamAction(formData: FormData): Promise<void> {
  await assertWebActionRequest();

  const session = await assertVerifiedOrgStructurePermission();
  const repository = createSqlOrgStructureRepository(getWebDatabase());
  const now = new Date();
  let destination = orgStructureDestination("invalid");

  try {
    const requestedId = readOptionalFormString(formData, "id");
    const existing =
      requestedId === undefined
        ? undefined
        : await findTeam(repository, session.tenantId, requestedId);

    if (requestedId !== undefined && existing === undefined) {
      throw new Error("Team not found.");
    }

    const id = existing?.id ?? `team:${session.tenantId}:${randomUUID()}`;
    const team = await repository.upsertTeam({
      id,
      tenantId: session.tenantId,
      name: readRequiredLimitedFormString(formData, "name", 120),
      updatedAt: now
    });
    const action: OrgStructureAuditAction =
      existing === undefined ? "team.created" : "team.updated";

    await recordOrgStructureAudit({
      tenantId: session.tenantId,
      actorEmployeeId: session.employeeId,
      action,
      entityType: "team",
      entityId: team.id,
      metadata: {
        name: team.name
      },
      occurredAt: now
    });

    destination = orgStructureDestination("team_saved");
  } catch {
    destination = orgStructureDestination("invalid");
  }

  revalidateOrgStructurePaths();
  redirect(destination);
}

export async function upsertWorkQueueAction(formData: FormData): Promise<void> {
  await assertWebActionRequest();

  const session = await assertVerifiedOrgStructurePermission();
  const repository = createSqlOrgStructureRepository(getWebDatabase());
  const now = new Date();
  let destination = orgStructureDestination("invalid");

  try {
    const requestedId = readOptionalFormString(formData, "id");
    const existing =
      requestedId === undefined
        ? undefined
        : await findWorkQueue(repository, session.tenantId, requestedId);

    if (requestedId !== undefined && existing === undefined) {
      throw new Error("Work queue not found.");
    }

    const id = existing?.id ?? `work_queue:${session.tenantId}:${randomUUID()}`;
    const workQueue = await repository.upsertWorkQueue({
      id,
      tenantId: session.tenantId,
      name: readRequiredLimitedFormString(formData, "name", 120),
      kind: readWorkQueueKind(formData, "kind"),
      owningOrgUnitId: readOptionalFormString(formData, "owningOrgUnitId"),
      status: existing?.status ?? "active",
      routingConfig: existing?.routingConfig ?? {},
      updatedAt: now
    });
    const action: OrgStructureAuditAction =
      existing === undefined ? "work_queue.created" : "work_queue.updated";

    await recordOrgStructureAudit({
      tenantId: session.tenantId,
      actorEmployeeId: session.employeeId,
      action,
      entityType: "work_queue",
      entityId: workQueue.id,
      metadata: {
        name: workQueue.name,
        kind: workQueue.kind,
        owningOrgUnitId: workQueue.owningOrgUnitId,
        status: workQueue.status
      },
      occurredAt: now
    });

    destination = orgStructureDestination("work_queue_saved");
  } catch {
    destination = orgStructureDestination("invalid");
  }

  revalidateOrgStructurePaths();
  redirect(destination);
}

export async function setWorkQueueStatusAction(
  formData: FormData
): Promise<void> {
  await assertWebActionRequest();

  const session = await assertVerifiedOrgStructurePermission();
  const repository = createSqlOrgStructureRepository(getWebDatabase());
  const now = new Date();
  let destination = orgStructureDestination("invalid");

  try {
    const id = readRequiredFormString(formData, "id");
    const status = readOrgStructureStatus(formData, "status");
    const existing = await findWorkQueue(repository, session.tenantId, id);

    if (existing === undefined) {
      throw new Error("Work queue not found.");
    }

    const workQueue = await repository.upsertWorkQueue({
      id: existing.id,
      tenantId: session.tenantId,
      name: existing.name,
      kind: existing.kind,
      owningOrgUnitId: existing.owningOrgUnitId,
      status,
      routingConfig: existing.routingConfig,
      updatedAt: now
    });
    const action: OrgStructureAuditAction =
      status === "active" ? "work_queue.restored" : "work_queue.archived";

    await recordOrgStructureAudit({
      tenantId: session.tenantId,
      actorEmployeeId: session.employeeId,
      action,
      entityType: "work_queue",
      entityId: workQueue.id,
      metadata: {
        name: workQueue.name,
        previousStatus: existing.status,
        nextStatus: workQueue.status
      },
      occurredAt: now
    });

    destination = orgStructureDestination(
      status === "active" ? "work_queue_restored" : "work_queue_archived"
    );
  } catch {
    destination = orgStructureDestination("invalid");
  }

  revalidateOrgStructurePaths();
  redirect(destination);
}

function orgStructureDestination(status: string): string {
  return `/admin/org-structure?orgStructureStatus=${encodeURIComponent(status)}`;
}

function revalidateOrgStructurePaths(): void {
  revalidatePath("/admin");
  revalidatePath("/admin/org-structure");
  revalidatePath("/admin/roles");
  revalidatePath("/admin/employees/[employeeId]/access", "page");
}

async function assertVerifiedOrgStructurePermission(): ReturnType<
  typeof assertCurrentWebTenantPermission
> {
  try {
    return await assertCurrentWebTenantPermission("employees.manage", {
      requireVerifiedEmail: true
    });
  } catch (error) {
    if (isEmailNotVerifiedError(error)) {
      redirect(orgStructureDestination("email_verification_required"));
    }

    throw error;
  }
}

async function findOrgUnit(
  repository: OrgStructureRepository,
  tenantId: TenantId,
  id: string
): Promise<OrgUnitRecord | undefined> {
  const orgUnits = await repository.listOrgUnits({ tenantId });

  return orgUnits.find((orgUnit) => orgUnit.id === id);
}

async function findWorkQueue(
  repository: OrgStructureRepository,
  tenantId: TenantId,
  id: string
): Promise<WorkQueueRecord | undefined> {
  const workQueues = await repository.listWorkQueues({ tenantId });

  return workQueues.find((workQueue) => workQueue.id === id);
}

async function findTeam(
  repository: OrgStructureRepository,
  tenantId: TenantId,
  id: string
): Promise<TeamRecord | undefined> {
  const teams = await repository.listTeams({ tenantId });

  return teams.find((team) => team.id === id);
}

async function recordOrgStructureAudit(input: {
  readonly tenantId: TenantId;
  readonly actorEmployeeId: EmployeeId;
  readonly action: OrgStructureAuditAction;
  readonly entityType: "org_unit" | "team" | "work_queue";
  readonly entityId: string;
  readonly metadata: Record<string, unknown>;
  readonly occurredAt: Date;
}): Promise<void> {
  await createSqlSecurityAuditRepository(getWebDatabase()).record({
    id: `audit:${input.tenantId}:${input.action}:${randomUUID()}`,
    tenantId: input.tenantId,
    actorEmployeeId: input.actorEmployeeId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    metadata: input.metadata,
    occurredAt: input.occurredAt
  });
}

function readOrgUnitKind(formData: FormData, name: string): OrgUnitKind {
  const value = readRequiredFormString(formData, name);

  if (!orgUnitKinds.includes(value as OrgUnitKind)) {
    throw new Error(`Form field ${name} must be a known org unit kind.`);
  }

  return value as OrgUnitKind;
}

function readWorkQueueKind(formData: FormData, name: string): WorkQueueKind {
  const value = readRequiredFormString(formData, name);

  if (!workQueueKinds.includes(value as WorkQueueKind)) {
    throw new Error(`Form field ${name} must be a known work queue kind.`);
  }

  return value as WorkQueueKind;
}

function readOrgStructureStatus(
  formData: FormData,
  name: string
): OrgStructureStatus {
  const value = readRequiredFormString(formData, name);

  if (!orgStructureStatuses.includes(value as OrgStructureStatus)) {
    throw new Error(`Form field ${name} must be a known status.`);
  }

  return value as OrgStructureStatus;
}

function readRequiredLimitedFormString(
  formData: FormData,
  name: string,
  maxLength: number
): string {
  const value = readRequiredFormString(formData, name);

  if (value.length > maxLength) {
    throw new Error(`Form field ${name} is too long.`);
  }

  return value;
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
