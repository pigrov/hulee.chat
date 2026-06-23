import type { EmployeeId, PlatformEvent, TenantId } from "@hulee/contracts";

import { createDomainEvent } from "./domain-events";
import { CoreError } from "./errors";
import { createSequentialIdFactory, type IdFactory } from "./ids";
import {
  assertEmployeeCan,
  isEmployeeRole,
  type Employee,
  type EmployeeRole
} from "./permissions";

export type EmployeeInvitation = {
  id: string;
  tenantId: TenantId;
  email: string;
  displayName?: string;
  role: EmployeeRole;
  tokenHash: string;
  invitedByEmployeeId: EmployeeId;
  expiresAt: string;
  acceptedAt?: string;
  revokedAt?: string;
  createdAt: string;
};

export type CreateEmployeeInvitationInput = {
  now: string;
  tenantId: TenantId;
  actor: Employee;
  email: string;
  displayName?: string;
  role: string;
  tokenHash: string;
  expiresAt: string;
  idFactory?: IdFactory;
};

export type CreatedEmployeeInvitation = {
  invitation: EmployeeInvitation;
  events: readonly PlatformEvent[];
};

export type AcceptEmployeeInvitationInput = {
  now: string;
  invitation: EmployeeInvitation;
  displayName?: string;
  idFactory?: IdFactory;
};

export type AcceptedEmployeeInvitation = {
  employee: Employee;
  events: readonly PlatformEvent[];
};

export function createEmployeeInvitation(
  input: CreateEmployeeInvitationInput
): CreatedEmployeeInvitation {
  if (input.actor.tenantId !== input.tenantId) {
    throw new CoreError("tenant.boundary_violation");
  }

  assertEmployeeCan(input.actor, "employees.manage");

  const email = normalizeEmail(input.email);
  const displayName = normalizeOptionalText(input.displayName);
  const role = parseEmployeeRole(input.role);
  const tokenHash = requireTokenHash(input.tokenHash);
  const expiresAt = requireFutureTimestamp(input.expiresAt, input.now);
  const ids = input.idFactory ?? createSequentialIdFactory(input.tenantId);
  const invitation: EmployeeInvitation = {
    id: ids.stringId("employee_invitation"),
    tenantId: input.tenantId,
    email,
    displayName,
    role,
    tokenHash,
    invitedByEmployeeId: input.actor.id,
    expiresAt,
    createdAt: input.now
  };

  return {
    invitation,
    events: [
      createDomainEvent({
        id: ids.eventId("employee.invited"),
        type: "employee.invited",
        tenantId: input.tenantId,
        occurredAt: input.now,
        payload: {
          invitationId: invitation.id,
          email,
          role
        }
      })
    ]
  };
}

export function acceptEmployeeInvitation(
  input: AcceptEmployeeInvitationInput
): AcceptedEmployeeInvitation {
  assertInvitationPending(input.invitation, input.now);

  const ids =
    input.idFactory ?? createSequentialIdFactory(input.invitation.tenantId);
  const displayName =
    normalizeOptionalText(input.displayName) ??
    input.invitation.displayName ??
    input.invitation.email;
  const employee: Employee = {
    id: ids.employeeId(),
    tenantId: input.invitation.tenantId,
    email: input.invitation.email,
    displayName,
    roles: [input.invitation.role],
    createdAt: input.now
  };

  return {
    employee,
    events: [
      createDomainEvent({
        id: ids.eventId("employee.created"),
        type: "employee.created",
        tenantId: employee.tenantId,
        occurredAt: input.now,
        payload: {
          employeeId: employee.id
        }
      }),
      createDomainEvent({
        id: ids.eventId("employee.invitation_accepted"),
        type: "employee.invitation_accepted",
        tenantId: employee.tenantId,
        occurredAt: input.now,
        payload: {
          invitationId: input.invitation.id,
          employeeId: employee.id
        }
      })
    ]
  };
}

function assertInvitationPending(
  invitation: EmployeeInvitation,
  now: string
): void {
  if (
    invitation.acceptedAt !== undefined ||
    invitation.revokedAt !== undefined
  ) {
    throw new CoreError("validation.failed");
  }

  requireFutureTimestamp(invitation.expiresAt, now);
}

function parseEmployeeRole(value: string): EmployeeRole {
  if (!isEmployeeRole(value)) {
    throw new CoreError("validation.failed");
  }

  return value;
}

function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new CoreError("validation.failed");
  }

  return email;
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim();

  return normalized && normalized.length > 0 ? normalized : undefined;
}

function requireTokenHash(value: string): string {
  const tokenHash = value.trim();

  if (!/^sha256:[a-f0-9]{64}$/.test(tokenHash)) {
    throw new CoreError("validation.failed");
  }

  return tokenHash;
}

function requireFutureTimestamp(timestamp: string, now: string): string {
  const expiresAt = new Date(timestamp);
  const currentTime = new Date(now);

  if (
    Number.isNaN(expiresAt.getTime()) ||
    Number.isNaN(currentTime.getTime()) ||
    expiresAt.getTime() <= currentTime.getTime()
  ) {
    throw new CoreError("validation.failed");
  }

  return timestamp;
}
