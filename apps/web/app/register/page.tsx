import { defaultBrandProfile } from "@hulee/branding";
import { createTranslator } from "@hulee/i18n";
import { UserPlus } from "lucide-react";
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

export default async function RegisterPage(): Promise<ReactNode> {
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
      <section className="loginPanel" aria-labelledby="register-title">
        <div className="brandMark" aria-label={defaultBrandProfile.productName}>
          {buildBrandMarkLabel(defaultBrandProfile)}
        </div>
        <div>
          <p className="eyebrow">{t("auth.register.eyebrow")}</p>
          <h1 className="adminTitle" id="register-title">
            {t("auth.register.title")}
          </h1>
          <p className="metaText">{t("auth.register.description")}</p>
        </div>
        <AuthActionForm
          actionKind="register"
          className="settingsForm"
          messages={authActionMessages(t)}
        >
          <label className="fieldStack">
            <span className="detailLabel">{t("auth.companyName")}</span>
            <input
              className="textInput"
              name="tenantDisplayName"
              type="text"
              autoComplete="organization"
              required
            />
          </label>
          <label className="fieldStack">
            <span className="detailLabel">{t("auth.displayName")}</span>
            <input
              className="textInput"
              name="adminDisplayName"
              type="text"
              autoComplete="name"
            />
          </label>
          <label className="fieldStack">
            <span className="detailLabel">{t("auth.email")}</span>
            <EmailInput className="textInput" name="email" required />
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
          <AuthSubmitButton
            className="primaryButton"
            label={t("auth.register.submit")}
          >
            <UserPlus size={18} aria-hidden="true" />
          </AuthSubmitButton>
          <p className="authSwitch">
            {t("auth.register.haveAccount")}{" "}
            <Link href="/login">{t("auth.login.link")}</Link>
          </p>
        </AuthActionForm>
      </section>
    </main>
  );
}
