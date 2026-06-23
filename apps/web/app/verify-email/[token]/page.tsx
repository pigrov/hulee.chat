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
  const verified = result.status === "verified";

  return (
    <main className="loginPage" style={brandProfileToCssProperties(brand)}>
      <section className="loginPanel" aria-labelledby="verify-email-title">
        <div className="brandMark" aria-label={brand.productName}>
          {buildBrandMarkLabel(brand)}
        </div>
        <div>
          <p className="eyebrow">{t("auth.emailVerification.eyebrow")}</p>
          <h1 className="adminTitle" id="verify-email-title">
            {verified
              ? t("auth.emailVerification.title")
              : t("auth.emailVerification.invalidTitle")}
          </h1>
          <p className="metaText">
            {verified
              ? t("auth.emailVerification.description", {
                  company: result.tenantDisplayName
                })
              : t("auth.emailVerification.invalid")}
          </p>
        </div>
        <p className={verified ? "formNotice" : "formError"}>
          {verified ? (
            <CheckCircle2 size={18} aria-hidden="true" />
          ) : (
            <XCircle size={18} aria-hidden="true" />
          )}
          {verified
            ? t("auth.emailVerification.complete")
            : t("auth.emailVerification.unavailable")}
        </p>
        <p className="authSwitch">
          <Link href="/login">{t("auth.login.link")}</Link>
        </p>
      </section>
    </main>
  );
}
