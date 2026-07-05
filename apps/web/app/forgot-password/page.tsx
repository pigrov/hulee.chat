import { defaultBrandProfile } from "@hulee/branding";
import { createTranslator } from "@hulee/i18n";
import { Mail } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { authActionMessages } from "../../src/auth-action-messages";
import { AuthActionForm, AuthSubmitButton } from "../../src/auth-action-form";
import {
  brandProfileToCssProperties,
  buildBrandMarkLabel
} from "../../src/brand-style";
import { EmailInput } from "../../src/contact-fields";
import { resolveCurrentWebAccessSession } from "../../src/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function ForgotPasswordPage(): Promise<ReactNode> {
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
        <AuthActionForm
          actionKind="forgotPassword"
          className="settingsForm"
          messages={authActionMessages(t)}
          resetOnSuccess
        >
          <label className="fieldStack">
            <span className="detailLabel">{t("auth.email")}</span>
            <EmailInput className="textInput" name="email" required />
          </label>
          <AuthSubmitButton
            className="primaryButton"
            label={t("auth.forgotPassword.submit")}
          >
            <Mail size={18} aria-hidden="true" />
          </AuthSubmitButton>
          <p className="authSwitch">
            <Link href="/login">{t("auth.login.link")}</Link>
          </p>
        </AuthActionForm>
      </section>
    </main>
  );
}
