import type { EventEnvelope, EventId, TenantId } from "@hulee/contracts";

export type TenantScope = {
  tenantId: TenantId;
};

export function assertTenantBoundary(
  scope: TenantScope,
  entity: TenantScope
): void {
  if (scope.tenantId !== entity.tenantId) {
    throw new Error("tenant.boundary_violation");
  }
}

export function createDomainEvent<TType extends string, TPayload>(input: {
  id: EventId;
  type: TType;
  tenantId: TenantId;
  occurredAt: string;
  payload: TPayload;
  idempotencyKey?: string;
}): EventEnvelope<TType, TPayload> {
  return {
    id: input.id,
    type: input.type,
    version: "v1",
    tenantId: input.tenantId,
    occurredAt: input.occurredAt,
    idempotencyKey: input.idempotencyKey,
    payload: input.payload
  };
}
