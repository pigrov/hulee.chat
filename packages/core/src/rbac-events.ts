import type { EventId, PlatformEvent, TenantId } from "@hulee/contracts";

import { createDomainEvent } from "./domain-events";

export const rbacEventTypes = [
  "role.created",
  "role.updated",
  "role.archived",
  "role.restored",
  "role_binding.created",
  "role_binding.revoked",
  "direct_grant.created",
  "direct_grant.revoked"
] as const;

export type RbacEventType = (typeof rbacEventTypes)[number];
export type RbacEvent<TType extends RbacEventType = RbacEventType> = Extract<
  PlatformEvent,
  { type: TType }
>;
export type RbacEventPayload<TType extends RbacEventType> =
  RbacEvent<TType>["payload"];

export type CreateRbacEventInput<TType extends RbacEventType> = {
  readonly id: EventId;
  readonly tenantId: TenantId;
  readonly type: TType;
  readonly occurredAt: string;
  readonly payload: RbacEventPayload<TType>;
  readonly idempotencyKey?: string;
};

export function createRbacEvent<TType extends RbacEventType>(
  input: CreateRbacEventInput<TType>
): RbacEvent<TType> {
  return createDomainEvent({
    id: input.id,
    type: input.type,
    tenantId: input.tenantId,
    occurredAt: input.occurredAt,
    payload: input.payload,
    idempotencyKey: input.idempotencyKey
  }) as RbacEvent<TType>;
}
