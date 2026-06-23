import { defaultBrandProfile } from "@hulee/branding";
import { createTranslator } from "@hulee/i18n";
import { KeyRound } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { resetPasswordAction } from "../../../src/auth-actions";
import { loadPasswordResetPreview } from "../../../src/auth-email";
import {
  brandProfileToCssProperties,
  buildBrandMarkLabel
} from "../../../src/brand-style";
import { resolveCurrentWebAccessSession } from "../../../src/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function ResetPasswordPage({
  params,
  searchParams
}: {
  params: Promise<{ token: string }>;
  searchParams?: Promise<{ error?: string }>;
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

  const [{ token }, resolvedSearchParams] = await Promise.all([
    params,
    searchParams
  ]);
  const resetPreview = await loadPasswordResetPreview(token);
  const activePreview =
    resetPreview.status === "available" ? resetPreview.preview : null;
  const brand = {
    ...defaultBrandProfile,
    productName: activePreview?.productName ?? defaultBrandProfile.productName,
    shortProductName:
      activePreview?.productName ?? defaultBrandProfile.shortProductName
  };
  const { t } = createTranslator("ru");

  return (
    <main className="loginPage" style={brandProfileToCssProperties(brand)}>
      <section className="loginPanel" aria-labelledby="reset-password-title">
        <div className="brandMark" aria-label={brand.productName}>
          {buildBrandMarkLabel(brand)}
        </div>
        <div>
          <p className="eyebrow">{t("auth.resetPassword.eyebrow")}</p>
          <h1 className="adminTitle" id="reset-password-title">
            {t("auth.resetPassword.title")}
          </h1>
          <p className="metaText">
            {activePreview
              ? t("auth.resetPassword.description", {
                  company: activePreview.tenantDisplayName
                })
              : t("auth.resetPassword.invalid")}
          </p>
        </div>

        {activePreview === null ? (
          <>
            <p className="formError">{t("auth.resetPassword.unavailable")}</p>
            <p className="authSwitch">
              <Link href="/forgot-password">
                {t("auth.forgotPassword.link")}
              </Link>
            </p>
          </>
        ) : (
          <form className="settingsForm" action={resetPasswordAction}>
            <input name="token" type="hidden" value={token} />
            <label className="fieldStack">
              <span className="detailLabel">{t("auth.email")}</span>
              <input
                className="textInput"
                type="email"
                value={activePreview.token.email}
                readOnly
              />
            </label>
            <label className="fieldStack">
              <span className="detailLabel">{t("auth.password")}</span>
              <input
                className="textInput"
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
              />
            </label>
            {resolvedSearchParams?.error === "invalid" ? (
              <p className="formError">{t("auth.resetPassword.invalid")}</p>
            ) : null}
            <button className="primaryButton" type="submit">
              <KeyRound size={18} aria-hidden="true" />
              {t("auth.resetPassword.submit")}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
