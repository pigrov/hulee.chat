import { defaultBrandProfile } from "@hulee/branding";
import { createTranslator } from "@hulee/i18n";
import { Mail } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { forgotPasswordAction } from "../../src/auth-actions";
import {
  brandProfileToCssProperties,
  buildBrandMarkLabel
} from "../../src/brand-style";
import { resolveCurrentWebAccessSession } from "../../src/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function ForgotPasswordPage({
  searchParams
}: {
  searchParams?: Promise<{ status?: string }>;
}): Promise<ReactNode> {
  const existingSession = await resolveCurrentWebAccessSession({
    allowDevelopmentFallback: false
  });

  if (existingSession !== null) {
    redirect(
      existingSession.platformRoles.includes("platform_admin")
        ? "/platform"
        : "/"
    );
  }

  const resolvedSearchParams = await searchParams;
  const hasSentNotice = resolvedSearchParams?.status === "sent";
  const { t } = createTranslator("ru");

  return (
    <main
      className="loginPage"
      style={brandProfileToCssProperties(defaultBrandProfile)}
    >
      <section className="loginPanel" aria-labelledby="forgot-password-title">
        <div className="brandMark" aria-label={defaultBrandProfile.productName}>
          {buildBrandMarkLabel(defaultBrandProfile)}
        </div>
        <div>
          <p className="eyebrow">{t("auth.forgotPassword.eyebrow")}</p>
          <h1 className="adminTitle" id="forgot-password-title">
            {t("auth.forgotPassword.title")}
          </h1>
          <p className="metaText">{t("auth.forgotPassword.description")}</p>
        </div>
        <form className="settingsForm" action={forgotPasswordAction}>
          <label className="fieldStack">
            <span className="detailLabel">{t("auth.tenantSlug")}</span>
            <input
              className="textInput"
              name="tenantSlug"
              type="text"
              autoComplete="organization"
              defaultValue="local"
              required
            />
          </label>
          <label className="fieldStack">
            <span className="detailLabel">{t("auth.email")}</span>
            <input
              className="textInput"
              name="email"
              type="email"
              autoComplete="email"
              required
            />
          </label>
          {hasSentNotice ? (
            <p className="formNotice">{t("auth.forgotPassword.sent")}</p>
          ) : null}
          <button className="primaryButton" type="submit">
            <Mail size={18} aria-hidden="true" />
            {t("auth.forgotPassword.submit")}
          </button>
          <p className="authSwitch">
            <Link href="/login">{t("auth.login.link")}</Link>
          </p>
        </form>
      </section>
    </main>
  );
}
