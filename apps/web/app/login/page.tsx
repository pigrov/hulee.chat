import { defaultBrandProfile } from "@hulee/branding";
import { createTranslator } from "@hulee/i18n";
import { LogIn } from "lucide-react";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { loginAction } from "../../src/auth-actions";
import {
  brandProfileToCssProperties,
  buildBrandMarkLabel
} from "../../src/brand-style";
import { resolveCurrentWebAccessSession } from "../../src/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function LoginPage({
  searchParams
}: {
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

  const resolvedSearchParams = await searchParams;
  const hasInvalidCredentialsError = resolvedSearchParams?.error === "invalid";
  const { t } = createTranslator("ru");

  return (
    <main
      className="loginPage"
      style={brandProfileToCssProperties(defaultBrandProfile)}
    >
      <section className="loginPanel" aria-labelledby="login-title">
        <div className="brandMark" aria-label={defaultBrandProfile.productName}>
          {buildBrandMarkLabel(defaultBrandProfile)}
        </div>
        <div>
          <p className="eyebrow">{t("auth.local.eyebrow")}</p>
          <h1 className="adminTitle" id="login-title">
            {t("auth.login.title")}
          </h1>
          <p className="metaText">{t("auth.login.description")}</p>
        </div>
        <form className="settingsForm" action={loginAction}>
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
          <label className="fieldStack">
            <span className="detailLabel">{t("auth.password")}</span>
            <input
              className="textInput"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          {hasInvalidCredentialsError ? (
            <p className="formError">{t("auth.login.invalidCredentials")}</p>
          ) : null}
          <button className="primaryButton" type="submit">
            <LogIn size={18} aria-hidden="true" />
            {t("auth.login.submit")}
          </button>
        </form>
      </section>
    </main>
  );
}
