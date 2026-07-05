import type { PlatformEvent, TenantId } from "@hulee/contracts";
import { normalizeEmailAddress } from "@hulee/contact-identity";

import { createDomainEvent } from "./domain-events";
import { CoreError } from "./errors";
import { createSequentialIdFactory, type IdFactory } from "./ids";

export type AuthEmailTokenPurpose =
  | "email_verification"
  | "email_change_verification"
  | "password_reset";

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
    events: [createAuthEmailTokenCompletedEvent({ token, now: input.now, ids })]
  };
}

function createAuthEmailTokenCompletedEvent(input: {
  token: AuthEmailToken;
  now: string;
  ids: IdFactory;
}): PlatformEvent {
  switch (input.token.purpose) {
    case "email_verification":
      return createAccountEmailVerifiedEvent({
        now: input.now,
        tenantId: input.token.tenantId,
        accountId: input.token.accountId,
        idFactory: input.ids
      });
    case "email_change_verification":
      return createDomainEvent({
        id: input.ids.eventId("account.email_changed"),
        type: "account.email_changed",
        tenantId: input.token.tenantId,
        occurredAt: input.now,
        payload: {
          accountId: input.token.accountId,
          email: input.token.email
        }
      });
    case "password_reset":
      return createDomainEvent({
        id: input.ids.eventId("account.password_reset_completed"),
        type: "account.password_reset_completed",
        tenantId: input.token.tenantId,
        occurredAt: input.now,
        payload: {
          accountId: input.token.accountId
        }
      });
  }
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
):
  | "account.email_verification_requested"
  | "account.email_change_requested"
  | "account.password_reset_requested" {
  switch (purpose) {
    case "email_verification":
      return "account.email_verification_requested";
    case "email_change_verification":
      return "account.email_change_requested";
    case "password_reset":
      return "account.password_reset_requested";
  }
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
  try {
    return normalizeEmailAddress(value);
  } catch {
    throw new CoreError("validation.failed");
  }
}

function requirePurpose(value: AuthEmailTokenPurpose): AuthEmailTokenPurpose {
  if (
    value !== "email_verification" &&
    value !== "email_change_verification" &&
    value !== "password_reset"
  ) {
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
