import type { TenantId } from "@hulee/contracts";
import { describe, expect, it } from "vitest";

import {
  completeAuthEmailToken,
  CoreError,
  createAccountEmailVerifiedEvent,
  createAuthEmailToken,
  createSequentialIdFactory
} from "./index";

const tenantId = "tenant_auth_email" as TenantId;
const now = "2026-06-23T10:00:00.000Z";
const tokenHash =
  "sha256:1111111111111111111111111111111111111111111111111111111111111111";

describe("auth email tokens", () => {
  it("creates a tenant-scoped email verification token and event", () => {
    const result = createAuthEmailToken({
      now,
      tenantId,
      accountId: "account-1",
      email: " ADMIN@EXAMPLE.TEST ",
      purpose: "email_verification",
      tokenHash,
      expiresAt: "2026-06-24T10:00:00.000Z",
      idFactory: createSequentialIdFactory("auth-email")
    });

    expect(result.token).toMatchObject({
      tenantId,
      accountId: "account-1",
      email: "admin@example.test",
      purpose: "email_verification",
      tokenHash
    });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      tenantId,
      type: "account.email_verification_requested",
      payload: {
        accountId: "account-1",
        email: "admin@example.test"
      }
    });
  });

  it("creates a password reset requested event", () => {
    const result = createAuthEmailToken({
      now,
      tenantId,
      accountId: "account-1",
      email: "admin@example.test",
      purpose: "password_reset",
      tokenHash,
      expiresAt: "2026-06-24T10:00:00.000Z",
      idFactory: createSequentialIdFactory("auth-reset")
    });

    expect(result.events[0]?.type).toBe("account.password_reset_requested");
  });

  it("creates and completes an email change verification token", () => {
    const created = createAuthEmailToken({
      now,
      tenantId,
      accountId: "account-1",
      email: "new-admin@example.test",
      purpose: "email_change_verification",
      tokenHash,
      expiresAt: "2026-06-24T10:00:00.000Z",
      idFactory: createSequentialIdFactory("auth-email-change")
    });
    const completed = completeAuthEmailToken({
      now: "2026-06-23T10:05:00.000Z",
      tenantId,
      token: created.token,
      idFactory: createSequentialIdFactory("auth-email-change-complete")
    });

    expect(created.events[0]).toMatchObject({
      type: "account.email_change_requested",
      payload: {
        accountId: "account-1",
        email: "new-admin@example.test"
      }
    });
    expect(completed.events[0]).toMatchObject({
      type: "account.email_changed",
      payload: {
        accountId: "account-1",
        email: "new-admin@example.test"
      }
    });
  });

  it("completes a pending token with the matching completion event", () => {
    const created = createAuthEmailToken({
      now,
      tenantId,
      accountId: "account-1",
      email: "admin@example.test",
      purpose: "password_reset",
      tokenHash,
      expiresAt: "2026-06-24T10:00:00.000Z",
      idFactory: createSequentialIdFactory("auth-reset-source")
    });
    const completed = completeAuthEmailToken({
      now: "2026-06-23T10:05:00.000Z",
      tenantId,
      token: created.token,
      idFactory: createSequentialIdFactory("auth-reset-complete")
    });

    expect(completed.token.consumedAt).toBe("2026-06-23T10:05:00.000Z");
    expect(completed.events[0]).toMatchObject({
      type: "account.password_reset_completed",
      payload: {
        accountId: "account-1"
      }
    });
  });

  it("creates a reusable account email verified event", () => {
    const event = createAccountEmailVerifiedEvent({
      now,
      tenantId,
      accountId: "account-1",
      idFactory: createSequentialIdFactory("account-verified")
    });

    expect(event).toMatchObject({
      tenantId,
      type: "account.email_verified",
      payload: {
        accountId: "account-1"
      }
    });
  });

  it("rejects invalid hashes, expired tokens and cross-tenant completion", () => {
    expect(() => {
      createAuthEmailToken({
        now,
        tenantId,
        accountId: "account-1",
        email: "admin@example.test",
        purpose: "email_verification",
        tokenHash: "raw-token",
        expiresAt: "2026-06-24T10:00:00.000Z"
      });
    }).toThrow(new CoreError("validation.failed"));

    const created = createAuthEmailToken({
      now,
      tenantId,
      accountId: "account-1",
      email: "admin@example.test",
      purpose: "email_verification",
      tokenHash,
      expiresAt: "2026-06-24T10:00:00.000Z"
    });

    expect(() => {
      completeAuthEmailToken({
        now: "2026-06-25T10:00:00.000Z",
        tenantId,
        token: created.token
      });
    }).toThrow(new CoreError("validation.failed"));

    expect(() => {
      completeAuthEmailToken({
        now: "2026-06-23T10:05:00.000Z",
        tenantId: "tenant_other" as TenantId,
        token: created.token
      });
    }).toThrow(new CoreError("tenant.boundary_violation"));
  });
});
