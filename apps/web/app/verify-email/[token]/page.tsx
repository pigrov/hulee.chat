import { defaultBrandProfile } from "@hulee/branding";
import { createTranslator } from "@hulee/i18n";
import { CheckCircle2, XCircle } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { completeEmailVerificationToken } from "../../../src/auth-email";
import {
  brandProfileToCssProperties,
  buildBrandMarkLabel
} from "../../../src/brand-style";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function VerifyEmailPage({
  params
}: {
  params: Promise<{ token: string }>;
}): Promise<ReactNode> {
  const { token } = await params;
  const result = await completeEmailVerificationToken(token);
  const brand = {
    ...defaultBrandProfile,
    productName:
      result.status === "verified"
        ? result.productName
        : defaultBrandProfile.productName,
    shortProductName:
      result.status === "verified"
        ? result.productName
        : defaultBrandProfile.shortProductName
  };
  const { t } = createTranslator("ru");
  const completed = result.status !== "invalid";

  return (
    <main className="loginPage" style={brandProfileToCssProperties(brand)}>
      <section className="loginPanel" aria-labelledby="verify-email-title">
        <div className="brandMark" aria-label={brand.productName}>
          {buildBrandMarkLabel(brand)}
        </div>
        <div>
          <p className="eyebrow">{t("auth.emailVerification.eyebrow")}</p>
          <h1 className="adminTitle" id="verify-email-title">
            {verificationTitle(result.status, t)}
          </h1>
          <p className="metaText">{verificationDescription(result, t)}</p>
        </div>
        <p className={completed ? "formNotice" : "formError"}>
          {completed ? (
            <CheckCircle2 size={18} aria-hidden="true" />
          ) : (
            <XCircle size={18} aria-hidden="true" />
          )}
          {verificationCompletion(result.status, t)}
        </p>
        <p className="authSwitch">
          <Link href="/login">{t("auth.login.link")}</Link>
        </p>
      </section>
    </main>
  );
}

function verificationTitle(
  status: Awaited<ReturnType<typeof completeEmailVerificationToken>>["status"],
  t: ReturnType<typeof createTranslator>["t"]
): string {
  switch (status) {
    case "verified":
      return t("auth.emailVerification.title");
    case "email_changed":
      return t("auth.emailVerification.emailChangedTitle");
    case "invalid":
      return t("auth.emailVerification.invalidTitle");
  }
}

function verificationDescription(
  result: Awaited<ReturnType<typeof completeEmailVerificationToken>>,
  t: ReturnType<typeof createTranslator>["t"]
): string {
  switch (result.status) {
    case "verified":
      return t("auth.emailVerification.description", {
        company: result.tenantDisplayName
      });
    case "email_changed":
      return t("auth.emailVerification.emailChangedDescription", {
        company: result.tenantDisplayName
      });
    case "invalid":
      return t("auth.emailVerification.invalid");
  }
}

function verificationCompletion(
  status: Awaited<ReturnType<typeof completeEmailVerificationToken>>["status"],
  t: ReturnType<typeof createTranslator>["t"]
): string {
  switch (status) {
    case "verified":
      return t("auth.emailVerification.complete");
    case "email_changed":
      return t("auth.emailVerification.emailChangedComplete");
    case "invalid":
      return t("auth.emailVerification.unavailable");
  }
}
