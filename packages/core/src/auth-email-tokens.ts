import type { PlatformEvent, TenantId } from "@hulee/contracts";

import { createDomainEvent } from "./domain-events";
import { CoreError } from "./errors";
import { createSequentialIdFactory, type IdFactory } from "./ids";

export type AuthEmailTokenPurpose = "email_verification" | "password_reset";

export type AuthEmailToken = {
  id: string;
  tenantId: TenantId;
  accountId: string;
  email: string;
  purpose: AuthEmailTokenPurpose;
  tokenHash: string;
  expiresAt: string;
  consumedAt?: string;
  createdAt: string;
};

export type CreateAuthEmailTokenInput = {
  now: string;
  tenantId: TenantId;
  accountId: string;
  email: string;
  purpose: AuthEmailTokenPurpose;
  tokenHash: string;
  expiresAt: string;
  idFactory?: IdFactory;
};

export type CreatedAuthEmailToken = {
  token: AuthEmailToken;
  events: readonly PlatformEvent[];
};

export type CompleteAuthEmailTokenInput = {
  now: string;
  tenantId: TenantId;
  token: AuthEmailToken;
  idFactory?: IdFactory;
};

export type CompletedAuthEmailToken = {
  token: AuthEmailToken;
  events: readonly PlatformEvent[];
};

export type CreateAccountEmailVerifiedEventInput = {
  now: string;
  tenantId: TenantId;
  accountId: string;
  idFactory?: IdFactory;
};

export function createAuthEmailToken(
  input: CreateAuthEmailTokenInput
): CreatedAuthEmailToken {
  const email = normalizeEmail(input.email);
  const purpose = requirePurpose(input.purpose);
  const tokenHash = requireTokenHash(input.tokenHash);
  const expiresAt = requireFutureTimestamp(input.expiresAt, input.now);
  const accountId = requireNonEmpty(input.accountId);
  const ids = input.idFactory ?? createSequentialIdFactory(input.tenantId);
  const token: AuthEmailToken = {
    id: ids.stringId("auth_email_token"),
    tenantId: input.tenantId,
    accountId,
    email,
    purpose,
    tokenHash,
    expiresAt,
    createdAt: input.now
  };

  return {
    token,
    events: [
      createDomainEvent({
        id: ids.eventId(authEmailTokenRequestedEventType(purpose)),
        type: authEmailTokenRequestedEventType(purpose),
        tenantId: input.tenantId,
        occurredAt: input.now,
        payload: {
          accountId,
          email
        }
      })
    ]
  };
}

export function completeAuthEmailToken(
  input: CompleteAuthEmailTokenInput
): CompletedAuthEmailToken {
  assertTokenTenant(input.token, input.tenantId);
  assertTokenPending(input.token, input.now);

  const ids = input.idFactory ?? createSequentialIdFactory(input.tenantId);
  const token: AuthEmailToken = {
    ...input.token,
    consumedAt: input.now
  };

  return {
    token,
    events: [
      token.purpose === "email_verification"
        ? createAccountEmailVerifiedEvent({
            now: input.now,
            tenantId: input.tenantId,
            accountId: token.accountId,
            idFactory: ids
          })
        : createDomainEvent({
            id: ids.eventId(authEmailTokenCompletedEventType(token.purpose)),
            type: authEmailTokenCompletedEventType(token.purpose),
            tenantId: input.tenantId,
            occurredAt: input.now,
            payload: {
              accountId: token.accountId
            }
          })
    ]
  };
}

export function createAccountEmailVerifiedEvent(
  input: CreateAccountEmailVerifiedEventInput
): PlatformEvent {
  const ids = input.idFactory ?? createSequentialIdFactory(input.tenantId);
  const accountId = requireNonEmpty(input.accountId);

  return createDomainEvent({
    id: ids.eventId("account.email_verified"),
    type: "account.email_verified",
    tenantId: input.tenantId,
    occurredAt: input.now,
    payload: {
      accountId
    }
  });
}

function authEmailTokenRequestedEventType(
  purpose: AuthEmailTokenPurpose
): "account.email_verification_requested" | "account.password_reset_requested" {
  return purpose === "email_verification"
    ? "account.email_verification_requested"
    : "account.password_reset_requested";
}

function authEmailTokenCompletedEventType(
  purpose: AuthEmailTokenPurpose
): "account.email_verified" | "account.password_reset_completed" {
  return purpose === "email_verification"
    ? "account.email_verified"
    : "account.password_reset_completed";
}

function assertTokenTenant(token: AuthEmailToken, tenantId: TenantId): void {
  if (token.tenantId !== tenantId) {
    throw new CoreError("tenant.boundary_violation");
  }
}

function assertTokenPending(token: AuthEmailToken, now: string): void {
  if (token.consumedAt !== undefined) {
    throw new CoreError("validation.failed");
  }

  requireFutureTimestamp(token.expiresAt, now);
}

function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new CoreError("validation.failed");
  }

  return email;
}

function requirePurpose(value: AuthEmailTokenPurpose): AuthEmailTokenPurpose {
  if (value !== "email_verification" && value !== "password_reset") {
    throw new CoreError("validation.failed");
  }

  return value;
}

function requireNonEmpty(value: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new CoreError("validation.failed");
  }

  return normalized;
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
