import { defaultBrandProfile } from "@hulee/branding";
import { createTranslator } from "@hulee/i18n";
import { KeyRound } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { authActionMessages } from "../../../src/auth-action-messages";
import {
  AuthActionForm,
  AuthSubmitButton
} from "../../../src/auth-action-form";
import { loadPasswordResetPreview } from "../../../src/auth-email";
import {
  brandProfileToCssProperties,
  buildBrandMarkLabel
} from "../../../src/brand-style";
import { PasswordGuidance } from "../../../src/password-guidance";
import { resolveCurrentWebAccessSession } from "../../../src/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function ResetPasswordPage({
  params
}: {
  params: Promise<{ token: string }>;
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

  const { token } = await params;
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
          <AuthActionForm
            actionKind="resetPassword"
            className="settingsForm"
            messages={authActionMessages(t)}
          >
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
            <PasswordGuidance
              email={activePreview.token.email}
              inputId="reset-password-password"
              labels={{
                generate: t("auth.password.generateStrong"),
                hidePassword: t("auth.password.hide"),
                password: t("auth.password"),
                requirements: {
                  digit: t("auth.password.requirement.digit"),
                  minimum_length: t("auth.password.requirement.minimumLength"),
                  no_cyrillic: t("auth.password.requirement.noCyrillic"),
                  no_account_identifier: t(
                    "auth.password.requirement.noAccountIdentifier"
                  ),
                  no_surrounding_whitespace: t(
                    "auth.password.requirement.noSurroundingWhitespace"
                  ),
                  not_common_pattern: t(
                    "auth.password.requirement.notCommonPattern"
                  ),
                  symbol: t("auth.password.requirement.symbol"),
                  uppercase: t("auth.password.requirement.uppercase")
                },
                showPassword: t("auth.password.show"),
                title: t("auth.password.guidanceTitle")
              }}
            />
            <AuthSubmitButton
              className="primaryButton"
              label={t("auth.resetPassword.submit")}
            >
              <KeyRound size={18} aria-hidden="true" />
            </AuthSubmitButton>
          </AuthActionForm>
        )}
      </section>
    </main>
  );
}
