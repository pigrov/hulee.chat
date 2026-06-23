import { CoreError } from "@hulee/core";

import { resolveWebEnv } from "./session";

export type SendEmployeeInvitationEmailInput = {
  to: string;
  productName: string;
  tenantDisplayName: string;
  inviteUrl: string;
};

export type SendEmailResult =
  | { sent: true }
  | { sent: false; reason: "not_configured" | "provider_failed" };

const resendEmailEndpoint = "https://api.resend.com/emails";

export async function sendEmployeeInvitationEmail(
  input: SendEmployeeInvitationEmailInput
): Promise<SendEmailResult> {
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
