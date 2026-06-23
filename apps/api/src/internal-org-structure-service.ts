import type {
  EmployeeId,
  InternalOrgStructureResponse,
  InternalOrgUnit,
  InternalOrgUnitUpsertRequest,
  InternalWorkQueue,
  InternalWorkQueueUpsertRequest,
  TenantId
} from "@hulee/contracts";
import type {
  OrgStructureRepository,
  OrgUnitRecord,
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
  now?: () => Date;
  idFactory?: () => string;
};

export function createInternalOrgStructureService(
  options: InternalOrgStructureServiceOptions
): InternalOrgStructureService {
  const now = options.now ?? (() => new Date());
  const idFactory = options.idFactory ?? (() => randomUUID());

  return {
    async loadOrgStructure(context) {
      const [orgUnits, workQueues] = await Promise.all([
        options.repository.listOrgUnits({
          tenantId: context.tenantId
        }),
        options.repository.listWorkQueues({
          tenantId: context.tenantId
        })
      ]);

      return {
        orgUnits: orgUnits.map(mapOrgUnitRecord),
        workQueues: workQueues.map(mapWorkQueueRecord)
      };
    },

    async upsertOrgUnit(context, request) {
      const orgUnit = await options.repository.upsertOrgUnit({
        id: request.id ?? `org_unit:${context.tenantId}:${idFactory()}`,
        tenantId: context.tenantId,
        parentOrgUnitId: request.parentOrgUnitId,
        name: request.name,
        kind: request.kind,
        status: request.status,
        updatedAt: now()
      });

      return mapOrgUnitRecord(orgUnit);
    },

    async upsertWorkQueue(context, request) {
      const workQueue = await options.repository.upsertWorkQueue({
        id: request.id ?? `queue:${context.tenantId}:${idFactory()}`,
        tenantId: context.tenantId,
        name: request.name,
        kind: request.kind,
        owningOrgUnitId: request.owningOrgUnitId,
        status: request.status,
        routingConfig: request.routingConfig,
        updatedAt: now()
      });

      return mapWorkQueueRecord(workQueue);
    }
  };
}

function mapOrgUnitRecord(record: OrgUnitRecord): InternalOrgUnit {
  return {
    id: record.id,
    parentOrgUnitId: record.parentOrgUnitId,
    name: record.name,
    kind: record.kind,
    status: record.status
  };
}

function mapWorkQueueRecord(record: WorkQueueRecord): InternalWorkQueue {
  return {
    id: record.id,
    name: record.name,
    kind: record.kind,
    owningOrgUnitId: record.owningOrgUnitId,
    status: record.status,
    routingConfig: record.routingConfig
  };
}
