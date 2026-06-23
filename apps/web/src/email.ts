import { CoreError } from "@hulee/core";

import { resolveWebEnv } from "./session";

export type SendEmployeeInvitationEmailInput = {
  to: string;
  productName: string;
  tenantDisplayName: string;
  inviteUrl: string;
};

export type SendEmailVerificationEmailInput = {
  to: string;
  productName: string;
  tenantDisplayName: string;
  verifyUrl: string;
};

export type SendPasswordResetEmailInput = {
  to: string;
  productName: string;
  tenantDisplayName: string;
  resetUrl: string;
};

export type SendEmailResult =
  | { sent: true }
  | { sent: false; reason: "not_configured" | "provider_failed" };

const resendEmailEndpoint = "https://api.resend.com/emails";

export async function sendEmployeeInvitationEmail(
  input: SendEmployeeInvitationEmailInput
): Promise<SendEmailResult> {
  return sendTransactionalEmail({
    productName: input.productName,
    to: input.to,
    subject: `${input.tenantDisplayName} invited you to ${input.productName}`,
    text: [
      `${input.tenantDisplayName} invited you to ${input.productName}.`,
      "",
      `Accept the invitation: ${input.inviteUrl}`,
      "",
      "If you did not expect this invitation, ignore this email."
    ].join("\n"),
    html: [
      `<p>${escapeHtml(input.tenantDisplayName)} invited you to ${escapeHtml(input.productName)}.</p>`,
      `<p><a href="${escapeHtml(input.inviteUrl)}">Accept the invitation</a></p>`,
      "<p>If you did not expect this invitation, ignore this email.</p>"
    ].join("")
  });
}

export async function sendEmailVerificationEmail(
  input: SendEmailVerificationEmailInput
): Promise<SendEmailResult> {
  return sendTransactionalEmail({
    productName: input.productName,
    to: input.to,
    subject: `Verify your ${input.productName} email`,
    text: [
      `Verify your email for ${input.tenantDisplayName}.`,
      "",
      `Verify email: ${input.verifyUrl}`,
      "",
      "If you did not create this account, ignore this email."
    ].join("\n"),
    html: [
      `<p>Verify your email for ${escapeHtml(input.tenantDisplayName)}.</p>`,
      `<p><a href="${escapeHtml(input.verifyUrl)}">Verify email</a></p>`,
      "<p>If you did not create this account, ignore this email.</p>"
    ].join("")
  });
}

export async function sendPasswordResetEmail(
  input: SendPasswordResetEmailInput
): Promise<SendEmailResult> {
  return sendTransactionalEmail({
    productName: input.productName,
    to: input.to,
    subject: `Reset your ${input.productName} password`,
    text: [
      `A password reset was requested for ${input.tenantDisplayName}.`,
      "",
      `Reset password: ${input.resetUrl}`,
      "",
      "If you did not request this reset, ignore this email."
    ].join("\n"),
    html: [
      `<p>A password reset was requested for ${escapeHtml(input.tenantDisplayName)}.</p>`,
      `<p><a href="${escapeHtml(input.resetUrl)}">Reset password</a></p>`,
      "<p>If you did not request this reset, ignore this email.</p>"
    ].join("")
  });
}

async function sendTransactionalEmail(input: {
  productName: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<SendEmailResult> {
  const env = resolveWebEnv();
  const token = env.HULEE_RESEND_TOKEN?.trim();

  if (!token) {
    return {
      sent: false,
      reason: "not_configured"
    };
  }

  const from =
    env.HULEE_EMAIL_FROM?.trim() ||
    `${input.productName} <onboarding@resend.dev>`;
  const response = await fetch(resendEmailEndpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html
    })
  }).catch(() => null);

  if (response === null || !response.ok) {
    return {
      sent: false,
      reason: "provider_failed"
    };
  }

  return {
    sent: true
  };
}

export function resolvePublicBaseUrl(): string {
  const env = resolveWebEnv();
  const value = env.HULEE_PUBLIC_BASE_URL?.trim();

  if (!value) {
    return "http://127.0.0.1:3001";
  }

  try {
    return new URL(value).origin;
  } catch {
    throw new CoreError("validation.failed");
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
