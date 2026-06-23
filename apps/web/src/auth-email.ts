import {
  type AuthEmailTokenPreview,
  createSqlAuthEmailTokenRepository,
  hashAuthEmailToken,
  type AuthEmailTokenTarget,
  type TenantAuthAccount
} from "@hulee/db";
import {
  completeAuthEmailToken,
  createAuthEmailToken,
  createSequentialIdFactory
} from "@hulee/core";
import { hashLocalPassword } from "@hulee/modules";
import { randomBytes, randomUUID } from "node:crypto";

import {
  resolvePublicBaseUrl,
  sendEmailVerificationEmail,
  sendPasswordResetEmail,
  type SendEmailResult
} from "./email";
import { getWebDatabase } from "./session";

const emailVerificationTtlMs = 1000 * 60 * 60 * 24 * 7;
const passwordResetTtlMs = 1000 * 60 * 60;

export type CompleteEmailVerificationResult =
  | {
      status: "verified";
      tenantDisplayName: string;
      productName: string;
    }
  | { status: "invalid" };

export type PasswordResetPreviewResult =
  | {
      status: "available";
      preview: AuthEmailTokenPreview;
    }
  | { status: "invalid" };

export async function requestEmailVerificationForTenantAccount(
  tenantAccount: TenantAuthAccount
): Promise<SendEmailResult> {
  return requestEmailVerificationForAccount({
    tenantId: tenantAccount.tenantId,
    accountId: tenantAccount.accountId
  });
}

export async function requestEmailVerificationForAccount(input: {
  tenantId: TenantAuthAccount["tenantId"];
  accountId: string;
}): Promise<SendEmailResult> {
  const repository = createSqlAuthEmailTokenRepository(getWebDatabase());
  const target = await repository.findTargetByAccount({
    tenantId: input.tenantId,
    accountId: input.accountId
  });

  if (target === null) {
    return {
      sent: false,
      reason: "provider_failed"
    };
  }

  return requestAuthEmail({
    purpose: "email_verification",
    ttlMs: emailVerificationTtlMs,
    to: target.email,
    tenantId: target.tenantId,
    accountId: target.accountId,
    tenantDisplayName: target.tenantDisplayName,
    productName: target.productName
  });
}

export async function requestPasswordResetEmail(input: {
  email: string;
  tenantSlug?: string;
}): Promise<void> {
  const targets = await resolvePasswordResetTargets(input);

  if (targets.length === 0) {
    return;
  }

  await Promise.all(
    targets.map((target) => {
      return requestAuthEmail({
        purpose: "password_reset",
        ttlMs: passwordResetTtlMs,
        to: target.email,
        tenantId: target.tenantId,
        accountId: target.accountId,
        tenantDisplayName: target.tenantDisplayName,
        productName: target.productName
      });
    })
  );
}

export async function loadPasswordResetPreview(
  token: string
): Promise<PasswordResetPreviewResult> {
  const preview = await findValidAuthEmailToken(token, "password_reset");

  return preview === null
    ? { status: "invalid" }
    : { status: "available", preview };
}

export async function completeEmailVerificationToken(
  token: string
): Promise<CompleteEmailVerificationResult> {
  const repository = createSqlAuthEmailTokenRepository(getWebDatabase());
  const preview = await findValidAuthEmailToken(token, "email_verification");

  if (preview === null) {
    return {
      status: "invalid"
    };
  }

  const now = new Date();
  const completed = completeAuthEmailToken({
    now: now.toISOString(),
    tenantId: preview.token.tenantId,
    token: preview.token,
    idFactory: createSequentialIdFactory(`verify-email:${randomUUID()}`)
  });

  try {
    await repository.completeEmailVerification({
      token: completed.token,
      verifiedAt: now,
      events: completed.events
    });
  } catch {
    return {
      status: "invalid"
    };
  }

  return {
    status: "verified",
    tenantDisplayName: preview.tenantDisplayName,
    productName: preview.productName
  };
}

export async function resetPasswordWithToken(input: {
  token: string;
  password: string;
}): Promise<"complete" | "invalid"> {
  if (input.password.length < 8) {
    return "invalid";
  }

  const repository = createSqlAuthEmailTokenRepository(getWebDatabase());
  const preview = await findValidAuthEmailToken(input.token, "password_reset");

  if (preview === null) {
    return "invalid";
  }

  const now = new Date();
  const completed = completeAuthEmailToken({
    now: now.toISOString(),
    tenantId: preview.token.tenantId,
    token: preview.token,
    idFactory: createSequentialIdFactory(`reset-password:${randomUUID()}`)
  });
  const passwordHash = await hashLocalPassword(input.password);

  try {
    await repository.completePasswordReset({
      token: completed.token,
      passwordHash,
      resetAt: now,
      events: completed.events
    });
  } catch {
    return "invalid";
  }

  return "complete";
}

async function resolvePasswordResetTargets(input: {
  email: string;
  tenantSlug?: string;
}): Promise<readonly AuthEmailTokenTarget[]> {
  const repository = createSqlAuthEmailTokenRepository(getWebDatabase());

  if (input.tenantSlug !== undefined) {
    const target = await repository.findTargetByEmail({
      tenantSlug: input.tenantSlug,
      email: input.email
    });

    return target === null ? [] : [target];
  }

  return repository.listTargetsByEmail({
    email: input.email
  });
}

async function requestAuthEmail(input: {
  purpose: "email_verification" | "password_reset";
  ttlMs: number;
  to: string;
  tenantId: TenantAuthAccount["tenantId"];
  accountId: string;
  tenantDisplayName: string;
  productName: string;
}): Promise<SendEmailResult> {
  const repository = createSqlAuthEmailTokenRepository(getWebDatabase());
  const now = new Date();
  const token = randomBytes(32).toString("base64url");
  const created = createAuthEmailToken({
    now: now.toISOString(),
    tenantId: input.tenantId,
    accountId: input.accountId,
    email: input.to,
    purpose: input.purpose,
    tokenHash: hashAuthEmailToken(token),
    expiresAt: new Date(now.getTime() + input.ttlMs).toISOString(),
    idFactory: createSequentialIdFactory(`auth-email:${randomUUID()}`)
  });

  await repository.createToken(created);

  if (input.purpose === "email_verification") {
    return sendEmailVerificationEmail({
      to: input.to,
      productName: input.productName,
      tenantDisplayName: input.tenantDisplayName,
      verifyUrl: new URL(`/verify-email/${token}`, resolvePublicBaseUrl()).href
    });
  }

  return sendPasswordResetEmail({
    to: input.to,
    productName: input.productName,
    tenantDisplayName: input.tenantDisplayName,
    resetUrl: new URL(`/reset-password/${token}`, resolvePublicBaseUrl()).href
  });
}

async function findValidAuthEmailToken(
  token: string,
  purpose: "email_verification" | "password_reset"
): Promise<AuthEmailTokenPreview | null> {
  return createSqlAuthEmailTokenRepository(getWebDatabase()).findValidToken({
    tokenHash: hashAuthEmailToken(token),
    purpose,
    now: new Date()
  });
}
