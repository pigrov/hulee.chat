import type { EmployeeId, EventId, TenantId } from "@hulee/contracts";

import type { DirectPermissionGrant } from "./access-control";
import { CoreError } from "./errors";
import {
  assertPermissionScopeAllowed,
  isPermissionScope,
  type Permission,
  type PermissionScope
} from "./permissions";
import { createRbacEvent, type RbacEvent } from "./rbac-events";

export const defaultBreakGlassDurationMs = 60 * 60 * 1000;
export const maxBreakGlassDurationMs = 4 * 60 * 60 * 1000;

export type PrepareBreakGlassDirectGrantInput = {
  readonly tenantId: TenantId;
  readonly grantId: string;
  readonly eventId: EventId;
  readonly actorEmployeeId: EmployeeId;
  readonly targetEmployeeId: EmployeeId;
  readonly permission: Permission;
  readonly scope: PermissionScope;
  readonly reason: string;
  readonly now: Date | string;
  readonly expiresAt?: Date | string;
};

export type PreparedBreakGlassDirectGrant = {
  readonly directGrant: DirectPermissionGrant & {
    readonly id: string;
    readonly expiresAt: string;
  };
  readonly createdByEmployeeId: EmployeeId;
  readonly createdAt: string;
  readonly auditMetadata: Record<string, unknown>;
  readonly event: RbacEvent<"direct_grant.created">;
};

const breakGlassReasonPrefix = "break-glass:";
const maxBreakGlassReasonLength = 500;

export function prepareBreakGlassDirectGrant(
  input: PrepareBreakGlassDirectGrantInput
): PreparedBreakGlassDirectGrant {
  if (!isPermissionScope(input.scope)) {
    throw new CoreError("validation.failed");
  }

  assertPermissionScopeAllowed(input.permission, input.scope.type);

  const createdAt = parseTimestamp(input.now);
  const expiresAt =
    input.expiresAt === undefined
      ? new Date(createdAt.getTime() + defaultBreakGlassDurationMs)
      : parseTimestamp(input.expiresAt);
  const reason = normalizeBreakGlassReason(input.reason);

  assertShortFutureExpiry({
    createdAt,
    expiresAt
  });

  const grantReason = `${breakGlassReasonPrefix} ${reason}`;
  const expiresAtIso = expiresAt.toISOString();
  const createdAtIso = createdAt.toISOString();
  const directGrant = {
    id: input.grantId,
    tenantId: input.tenantId,
    employeeId: input.targetEmployeeId,
    permission: input.permission,
    scope: input.scope,
    reason: grantReason,
    expiresAt: expiresAtIso
  } satisfies DirectPermissionGrant & {
    readonly id: string;
    readonly expiresAt: string;
  };

  return {
    directGrant,
    createdByEmployeeId: input.actorEmployeeId,
    createdAt: createdAtIso,
    auditMetadata: {
      breakGlass: true,
      targetEmployeeId: input.targetEmployeeId,
      permission: input.permission,
      reason: grantReason,
      expiresAt: expiresAtIso,
      ...scopeMetadata(input.scope)
    },
    event: createRbacEvent({
      id: input.eventId,
      tenantId: input.tenantId,
      type: "direct_grant.created",
      occurredAt: createdAtIso,
      payload: {
        grantId: input.grantId,
        actorEmployeeId: input.actorEmployeeId,
        targetEmployeeId: input.targetEmployeeId,
        permission: input.permission,
        scope: permissionScopeEventPayload(input.scope),
        reason: grantReason,
        expiresAt: expiresAtIso
      }
    })
  };
}

function normalizeBreakGlassReason(value: string): string {
  const normalized = value.trim();
  const unprefixedReason = normalized.startsWith(breakGlassReasonPrefix)
    ? normalized.slice(breakGlassReasonPrefix.length).trim()
    : normalized;

  if (
    unprefixedReason.length === 0 ||
    unprefixedReason.length > maxBreakGlassReasonLength
  ) {
    throw new CoreError("validation.failed");
  }

  return unprefixedReason;
}

function assertShortFutureExpiry(input: {
  readonly createdAt: Date;
  readonly expiresAt: Date;
}): void {
  const durationMs = input.expiresAt.getTime() - input.createdAt.getTime();

  if (durationMs <= 0 || durationMs > maxBreakGlassDurationMs) {
    throw new CoreError("validation.failed");
  }
}

function parseTimestamp(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new CoreError("validation.failed");
  }

  return date;
}

function scopeMetadata(scope: PermissionScope): Record<string, string> {
  return "id" in scope
    ? {
        scopeType: scope.type,
        scopeId: scope.id
      }
    : {
        scopeType: scope.type
      };
}

function permissionScopeEventPayload(scope: PermissionScope): {
  readonly type: string;
  readonly id?: string;
} {
  return "id" in scope
    ? {
        type: scope.type,
        id: scope.id
      }
    : {
        type: scope.type
      };
}
