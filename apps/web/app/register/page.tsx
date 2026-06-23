import { defaultBrandProfile } from "@hulee/branding";
import { createTranslator } from "@hulee/i18n";
import { UserPlus } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { registerAction } from "../../src/auth-actions";
import {
  brandProfileToCssProperties,
  buildBrandMarkLabel
} from "../../src/brand-style";
import { resolveCurrentWebAccessSession } from "../../src/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function RegisterPage({
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
  const hasRegistrationError = resolvedSearchParams?.error === "invalid";
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
        <form className="settingsForm" action={registerAction}>
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
            <span className="detailLabel">{t("auth.tenantSlug")}</span>
            <input
              className="textInput"
              name="tenantSlug"
              type="text"
              autoComplete="organization-title"
              pattern="[A-Za-z0-9][A-Za-z0-9-]{1,62}"
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
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>
          {hasRegistrationError ? (
            <p className="formError">{t("auth.register.invalid")}</p>
          ) : null}
          <button className="primaryButton" type="submit">
            <UserPlus size={18} aria-hidden="true" />
            {t("auth.register.submit")}
          </button>
          <p className="authSwitch">
            {t("auth.register.haveAccount")}{" "}
            <Link href="/login">{t("auth.login.link")}</Link>
          </p>
        </form>
      </section>
    </main>
  );
}
