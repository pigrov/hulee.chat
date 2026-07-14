import type {
  EmployeeId,
  InternalOrgStructureResponse,
  InternalOrgUnit,
  InternalOrgUnitUpsertRequest,
  InternalWorkQueue,
  InternalWorkQueueUpsertRequest,
  TenantId
} from "@hulee/contracts";
import {
  canAccess,
  CoreError,
  resolveEffectivePermissionGrants,
  type EffectivePermissionGrant,
  type PermissionActor,
  type PermissionResourceContext
} from "@hulee/core";
import type {
  EmployeeDirectoryRepository,
  OrgStructureRepository,
  OrgUnitRecord,
  TenantRbacRepository,
  WorkQueueRecord
} from "@hulee/db";
import { randomUUID } from "node:crypto";

export type InternalOrgStructureContext = {
  requestId: string;
  tenantId: TenantId;
  employeeId: EmployeeId;
};

export type InternalOrgStructureService = {
  loadOrgStructure(
    context: InternalOrgStructureContext
  ): Promise<InternalOrgStructureResponse>;
  upsertOrgUnit(
    context: InternalOrgStructureContext,
    request: InternalOrgUnitUpsertRequest
  ): Promise<InternalOrgUnit>;
  upsertWorkQueue(
    context: InternalOrgStructureContext,
    request: InternalWorkQueueUpsertRequest
  ): Promise<InternalWorkQueue>;
};

export type InternalOrgStructureServiceOptions = {
  repository: OrgStructureRepository;
  employeeRepository: Pick<EmployeeDirectoryRepository, "findEmployee">;
  rbacRepository: Pick<TenantRbacRepository, "listEffectiveAccessSources">;
  now?: () => Date;
  idFactory?: () => string;
};

type OrgStructureActorAccess = {
  readonly actor: PermissionActor;
  readonly effectiveGrants: readonly EffectivePermissionGrant[];
};

export function createInternalOrgStructureService(
  options: InternalOrgStructureServiceOptions
): InternalOrgStructureService {
  const now = options.now ?? (() => new Date());
  const idFactory = options.idFactory ?? (() => randomUUID());

  return {
    async loadOrgStructure(context) {
      const at = now();
      const [actorAccess, orgUnits, workQueues] = await Promise.all([
        resolveActorAccess(context, options, at),
        options.repository.listOrgUnits({
          tenantId: context.tenantId
        }),
        options.repository.listWorkQueues({
          tenantId: context.tenantId
        })
      ]);
      const visibleOrgUnits = orgUnits.filter((orgUnit) =>
        canManageOrgStructureResource(actorAccess, orgUnitResource(orgUnit))
      );
      const visibleOrgUnitIds = new Set(
        visibleOrgUnits.map((orgUnit) => orgUnit.id)
      );
      const visibleWorkQueues = workQueues.filter((workQueue) =>
        canManageOrgStructureResource(actorAccess, workQueueResource(workQueue))
      );

      return {
        orgUnits: visibleOrgUnits.map((orgUnit) =>
          mapOrgUnitRecord(
            orgUnit,
            orgUnit.parentOrgUnitId === null ||
              visibleOrgUnitIds.has(orgUnit.parentOrgUnitId)
              ? orgUnit.parentOrgUnitId
              : null
          )
        ),
        workQueues: visibleWorkQueues.map((workQueue) =>
          mapWorkQueueRecord(
            workQueue,
            workQueue.owningOrgUnitId === null ||
              visibleOrgUnitIds.has(workQueue.owningOrgUnitId)
              ? workQueue.owningOrgUnitId
              : null
          )
        )
      };
    },

    async upsertOrgUnit(context, request) {
      const at = now();
      const [actorAccess, orgUnits] = await Promise.all([
        resolveActorAccess(context, options, at),
        options.repository.listOrgUnits({ tenantId: context.tenantId })
      ]);
      const existing = findRequestedExistingRecord(orgUnits, request.id);
      const parentOrgUnitId =
        request.parentOrgUnitId === undefined
          ? (existing?.parentOrgUnitId ?? null)
          : request.parentOrgUnitId;
      const destinationParent = findOrgUnitReference(
        orgUnits,
        parentOrgUnitId,
        true
      );

      if (existing === undefined) {
        assertCanManageOrgAnchor(
          actorAccess,
          context.tenantId,
          destinationParent
        );
      } else {
        assertCanManageOrgStructureResource(
          actorAccess,
          orgUnitResource(existing)
        );

        if (existing.parentOrgUnitId !== parentOrgUnitId) {
          const currentParent = findOrgUnitReference(
            orgUnits,
            existing.parentOrgUnitId,
            false
          );

          assertCanManageOrgAnchor(
            actorAccess,
            context.tenantId,
            currentParent
          );
          assertCanManageOrgAnchor(
            actorAccess,
            context.tenantId,
            destinationParent
          );
        }
      }

      assertValidOrgUnitParent(orgUnits, existing, parentOrgUnitId);

      const orgUnit = await options.repository.upsertOrgUnit({
        id: request.id ?? `org_unit:${context.tenantId}:${idFactory()}`,
        tenantId: context.tenantId,
        parentOrgUnitId,
        name: request.name,
        kind: request.kind,
        status: request.status,
        updatedAt: at
      });

      return mapOrgUnitRecord(
        orgUnit,
        canViewOrgUnitReference(actorAccess, destinationParent)
          ? orgUnit.parentOrgUnitId
          : null
      );
    },

    async upsertWorkQueue(context, request) {
      const at = now();
      const [actorAccess, orgUnits, workQueues] = await Promise.all([
        resolveActorAccess(context, options, at),
        options.repository.listOrgUnits({ tenantId: context.tenantId }),
        options.repository.listWorkQueues({ tenantId: context.tenantId })
      ]);
      const existing = findRequestedExistingRecord(workQueues, request.id);
      const owningOrgUnitId =
        request.owningOrgUnitId === undefined
          ? (existing?.owningOrgUnitId ?? null)
          : request.owningOrgUnitId;
      const destinationOwner = findOrgUnitReference(
        orgUnits,
        owningOrgUnitId,
        true
      );

      if (existing === undefined) {
        assertCanManageOrgAnchor(
          actorAccess,
          context.tenantId,
          destinationOwner
        );
      } else {
        assertCanManageOrgStructureResource(
          actorAccess,
          workQueueResource(existing)
        );

        if (existing.owningOrgUnitId !== owningOrgUnitId) {
          const currentOwner = findOrgUnitReference(
            orgUnits,
            existing.owningOrgUnitId,
            false
          );

          assertCanManageOrgAnchor(actorAccess, context.tenantId, currentOwner);
          assertCanManageOrgAnchor(
            actorAccess,
            context.tenantId,
            destinationOwner
          );
        }
      }

      const workQueue = await options.repository.upsertWorkQueue({
        id: request.id ?? `queue:${context.tenantId}:${idFactory()}`,
        tenantId: context.tenantId,
        name: request.name,
        kind: request.kind,
        owningOrgUnitId,
        status: request.status,
        routingConfig: request.routingConfig,
        updatedAt: at
      });

      return mapWorkQueueRecord(
        workQueue,
        canViewOrgUnitReference(actorAccess, destinationOwner)
          ? workQueue.owningOrgUnitId
          : null
      );
    }
  };
}

async function resolveActorAccess(
  context: InternalOrgStructureContext,
  options: Pick<
    InternalOrgStructureServiceOptions,
    "employeeRepository" | "rbacRepository"
  >,
  at: Date
): Promise<OrgStructureActorAccess> {
  const employee = await options.employeeRepository.findEmployee({
    tenantId: context.tenantId,
    employeeId: context.employeeId
  });

  if (
    employee === null ||
    employee.tenantId !== context.tenantId ||
    employee.deactivatedAt !== null
  ) {
    throw new CoreError("permission.denied");
  }

  const actor: PermissionActor = {
    tenantId: employee.tenantId,
    employeeId: employee.employeeId,
    orgUnitIds: employee.orgUnitIds,
    queueIds: employee.queueIds,
    teamIds: employee.teamIds
  };
  const sources = await options.rbacRepository.listEffectiveAccessSources({
    actor,
    at
  });

  return {
    actor,
    effectiveGrants: resolveEffectivePermissionGrants({
      actor,
      roles: sources.roles,
      roleBindings: sources.roleBindings,
      directGrants: sources.directGrants,
      at
    })
  };
}

function canManageOrgStructureResource(
  actorAccess: OrgStructureActorAccess,
  resource: PermissionResourceContext
): boolean {
  return canAccess({
    actor: actorAccess.actor,
    effectiveGrants: actorAccess.effectiveGrants,
    permission: "employees.manage",
    resource
  }).allowed;
}

function assertCanManageOrgStructureResource(
  actorAccess: OrgStructureActorAccess,
  resource: PermissionResourceContext
): void {
  if (!canManageOrgStructureResource(actorAccess, resource)) {
    throw new CoreError("permission.denied");
  }
}

function assertCanManageOrgAnchor(
  actorAccess: OrgStructureActorAccess,
  tenantId: TenantId,
  orgUnit: OrgUnitRecord | null
): void {
  assertCanManageOrgStructureResource(
    actorAccess,
    orgUnit === null ? { tenantId } : orgUnitResource(orgUnit)
  );
}

function canViewOrgUnitReference(
  actorAccess: OrgStructureActorAccess,
  orgUnit: OrgUnitRecord | null
): boolean {
  return (
    orgUnit === null ||
    canManageOrgStructureResource(actorAccess, orgUnitResource(orgUnit))
  );
}

function orgUnitResource(record: OrgUnitRecord): PermissionResourceContext {
  return {
    tenantId: record.tenantId,
    orgUnitId: record.id,
    orgUnitIds: [record.id]
  };
}

function workQueueResource(record: WorkQueueRecord): PermissionResourceContext {
  return {
    tenantId: record.tenantId,
    orgUnitId: record.owningOrgUnitId ?? undefined,
    queueId: record.id
  };
}

function findRequestedExistingRecord<TRecord extends { readonly id: string }>(
  records: readonly TRecord[],
  requestedId: string | undefined
): TRecord | undefined {
  if (requestedId === undefined) {
    return undefined;
  }

  const existing = records.find((record) => record.id === requestedId);

  if (existing === undefined) {
    throw new CoreError("permission.denied");
  }

  return existing;
}

function findOrgUnitReference(
  orgUnits: readonly OrgUnitRecord[],
  orgUnitId: string | null,
  requireActive: boolean
): OrgUnitRecord | null {
  if (orgUnitId === null) {
    return null;
  }

  const orgUnit = orgUnits.find((candidate) => candidate.id === orgUnitId);

  if (orgUnit === undefined || (requireActive && orgUnit.status !== "active")) {
    throw new CoreError("permission.denied");
  }

  return orgUnit;
}

function assertValidOrgUnitParent(
  orgUnits: readonly OrgUnitRecord[],
  existing: OrgUnitRecord | undefined,
  parentOrgUnitId: string | null
): void {
  if (existing === undefined || parentOrgUnitId === null) {
    return;
  }

  if (
    parentOrgUnitId === existing.id ||
    collectOrgUnitDescendantIds(orgUnits, existing.id).has(parentOrgUnitId)
  ) {
    throw new CoreError("validation.failed");
  }
}

function collectOrgUnitDescendantIds(
  orgUnits: readonly OrgUnitRecord[],
  orgUnitId: string
): ReadonlySet<string> {
  const childrenByParent = new Map<string, OrgUnitRecord[]>();

  for (const orgUnit of orgUnits) {
    if (orgUnit.parentOrgUnitId === null) {
      continue;
    }

    childrenByParent.set(orgUnit.parentOrgUnitId, [
      ...(childrenByParent.get(orgUnit.parentOrgUnitId) ?? []),
      orgUnit
    ]);
  }

  const descendantIds = new Set<string>();
  const visit = (parentId: string): void => {
    for (const child of childrenByParent.get(parentId) ?? []) {
      if (descendantIds.has(child.id)) {
        continue;
      }

      descendantIds.add(child.id);
      visit(child.id);
    }
  };

  visit(orgUnitId);

  return descendantIds;
}

function mapOrgUnitRecord(
  record: OrgUnitRecord,
  parentOrgUnitId: string | null = record.parentOrgUnitId
): InternalOrgUnit {
  return {
    id: record.id,
    parentOrgUnitId,
    name: record.name,
    kind: record.kind,
    status: record.status
  };
}

function mapWorkQueueRecord(
  record: WorkQueueRecord,
  owningOrgUnitId: string | null = record.owningOrgUnitId
): InternalWorkQueue {
  return {
    id: record.id,
    name: record.name,
    kind: record.kind,
    owningOrgUnitId,
    status: record.status,
    routingConfig: record.routingConfig
  };
}
